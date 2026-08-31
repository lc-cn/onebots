import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BaseApp, writeConfigFileAtomic, yaml } from "@onebots/core";
import { EXTENSION_CATALOG, getExtensionCatalogEntry } from "./extension-catalog.js";
import { buildAdapterCapabilityReport, summarizeManifest } from "./capability-report.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionPackageCatalogEntry,
} from "./extension-capability-catalog.js";
import {
    getRuntimePluginSelection,
    setRuntimePluginSelection,
} from "./runtime-plugin-selection.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import type { LoadedPluginInfo } from "./plugin-loader.js";
import type { RuntimePluginSelection } from "./runtime-plugin-selection.js";
import { preflightServiceRuntimeIsolated } from "./service-preflight.js";
import { buildExtensionInstallInvocation } from "./package-manager.js";
import { validateExtensionConfigurationTarget } from "./extension-configuration-target.js";
import { validateExtensionCatalogIntegrity } from "./extension-catalog-integrity.js";

const execFileAsync = promisify(execFile);

export interface ExtensionInstaller {
    install(packageName: string, packageVersion: string, runtimeRoot: string): Promise<void>;
}

class RuntimeExtensionInstaller implements ExtensionInstaller {
    async install(packageName: string, packageVersion: string, runtimeRoot: string): Promise<void> {
        const invocation = buildExtensionInstallInvocation(
            runtimeRoot,
            `${packageName}@${packageVersion}`,
        );
        await execFileAsync(invocation.executable, invocation.args, {
            cwd: runtimeRoot,
            env: invocation.environment,
            timeout: 10 * 60 * 1000,
            maxBuffer: 4 * 1024 * 1024,
        });
    }
}

export interface ExtensionManagerOptions {
    runtimeRoot?: string;
    configPath?: string;
    installer?: ExtensionInstaller;
    preflight?: ExtensionConfigPreflight;
    catalogIssues?: () => string[];
}

export interface ExtensionConfigPreflightRequest {
    content: string;
    selection: RuntimePluginSelection;
    runtimeRoot: string;
    configPath: string;
}

export type ExtensionConfigPreflight = (request: ExtensionConfigPreflightRequest) => Promise<void>;

export class ExtensionNotFoundError extends Error {}
export class ExtensionInstallConflictError extends Error {}
export class ExtensionCatalogIntegrityError extends Error {}

/** 白名单扩展的安装、启用和运行态查询。 */
export class ExtensionManager {
    private readonly runtimeRoot: string;
    private readonly configPath: string;
    private readonly installer: ExtensionInstaller;
    private readonly preflight: ExtensionConfigPreflight;
    private readonly catalogIssues: () => string[];
    private installation: {
        id: string;
        promise: Promise<{ restartRequired: true }>;
    } | null = null;

    constructor(options: ExtensionManagerOptions = {}) {
        this.runtimeRoot = path.resolve(
            options.runtimeRoot ?? process.env.ONEBOTS_EXTENSION_ROOT ?? process.cwd(),
        );
        this.configPath = options.configPath ?? BaseApp.configPath;
        this.installer = options.installer ?? new RuntimeExtensionInstaller();
        this.preflight = options.preflight ?? preflightExtensionConfig;
        this.catalogIssues = options.catalogIssues ?? validateExtensionCatalogIntegrity;
    }

    list(loadedPlugins: readonly LoadedPluginInfo[]) {
        const selection = this.readSelection();
        const catalogIssues = this.catalogIssues();
        const catalogError = catalogIssues.length
            ? `扩展目录完整性校验失败：${catalogIssues.join("；")}`
            : null;
        const adapterCapabilities = new Map(
            buildAdapterCapabilityReport(loadedPlugins).adapters.map(adapter => [
                adapter.name,
                {
                    source: "runtime" as const,
                    packageVersion: adapter.packageVersion,
                    declared: adapter.declared,
                    summary: adapter.summary,
                    manifest: adapter.capabilities,
                },
            ]),
        );
        return EXTENSION_CATALOG.map(entry => {
            const packageCatalog = getExtensionPackageCatalogEntry(entry.packageName);
            const installedVersion = this.installedVersion(entry.packageName);
            const loaded = loadedPlugins.some(
                plugin => plugin.type === entry.type && plugin.name === entry.name,
            );
            const catalogCapability =
                entry.type === "adapter"
                    ? getExtensionCapabilityCatalogEntry(entry.name)
                    : undefined;
            return {
                ...entry,
                catalogError,
                configurationError: validateExtensionConfigurationTarget(entry),
                targetVersion: packageCatalog?.packageVersion ?? null,
                installedVersion,
                versionAligned:
                    packageCatalog !== undefined &&
                    installedVersion === packageCatalog.packageVersion,
                installed: installedVersion !== null,
                enabled: (entry.type === "adapter"
                    ? selection.adapters
                    : selection.protocols
                ).includes(entry.name),
                loaded,
                installing: this.installation?.id === entry.id,
                capability:
                    entry.type !== "adapter"
                        ? null
                        : loaded
                          ? (adapterCapabilities.get(entry.name) ?? {
                                source: "runtime" as const,
                                packageVersion: null,
                                declared: false,
                                summary: null,
                                manifest: null,
                            })
                          : !catalogError && catalogCapability
                            ? {
                                  source: "catalog" as const,
                                  packageVersion: catalogCapability.packageVersion,
                                  declared: true,
                                  summary: summarizeManifest(catalogCapability.manifest),
                                  manifest: catalogCapability.manifest,
                              }
                            : {
                                  source: "catalog" as const,
                                  packageVersion: null,
                                  declared: false,
                                  summary: null,
                                  manifest: null,
                              },
            };
        });
    }

    async install(id: string): Promise<{ restartRequired: true }> {
        const entry = getExtensionCatalogEntry(id);
        if (!entry) throw new ExtensionNotFoundError("扩展不存在或不允许从管理端安装");
        if (this.installation) {
            if (this.installation.id === id) return this.installation.promise;
            throw new ExtensionInstallConflictError(
                `扩展 ${this.installation.id} 正在安装，请稍后再试`,
            );
        }
        this.assertCatalogIntegrity();
        this.assertRuntimeRoot();
        const preparedConfig = this.prepareConfig(entry.type, entry.name);
        const packageCatalog = this.requirePackageCatalogEntry(entry.packageName);
        const promise = (async (): Promise<{ restartRequired: true }> => {
            if (this.installedVersion(entry.packageName) !== packageCatalog.packageVersion) {
                await this.installer.install(
                    entry.packageName,
                    packageCatalog.packageVersion,
                    this.runtimeRoot,
                );
                const installedVersion = this.installedVersion(entry.packageName);
                if (installedVersion !== packageCatalog.packageVersion) {
                    throw new Error(
                        `扩展安装版本校验失败：${entry.packageName} 期望 ${packageCatalog.packageVersion}，实际 ${installedVersion ?? "未安装"}`,
                    );
                }
            }
            let candidate = preparedConfig;
            for (let attempt = 0; attempt < 3; attempt++) {
                const latestSource = fs.readFileSync(this.configPath, "utf8");
                if (latestSource !== candidate.source) {
                    candidate = this.prepareConfig(entry.type, entry.name, latestSource);
                }
                await this.preflight({
                    content: candidate.content,
                    selection: candidate.selection,
                    runtimeRoot: this.runtimeRoot,
                    configPath: this.configPath,
                });
                if (fs.readFileSync(this.configPath, "utf8") !== candidate.source) continue;
                writeConfigFileAtomic(this.configPath, candidate.content, { backup: true });
                return { restartRequired: true };
            }
            throw new ExtensionInstallConflictError(
                "配置在扩展预检期间持续变化，请等待其他管理操作完成后重试",
            );
        })();
        this.installation = { id, promise };
        try {
            return await promise;
        } finally {
            if (this.installation?.promise === promise) this.installation = null;
        }
    }

    /** 在调用包管理器前验证配置，并生成不会丢失现有插件选择的候选内容。 */
    private prepareConfig(type: "adapter" | "protocol", name: string, source?: string) {
        const currentSource = source ?? fs.readFileSync(this.configPath, "utf8");
        const config = parseRuntimeConfig(currentSource);
        const currentSelection = getRuntimePluginSelection(config) ?? {
            adapters: [],
            protocols: [],
        };
        const selection = {
            adapters: [...currentSelection.adapters],
            protocols: [...currentSelection.protocols],
        };
        const key = type === "adapter" ? "adapters" : "protocols";
        if (!selection[key].includes(name)) selection[key].push(name);
        setRuntimePluginSelection(config, selection);
        return {
            source: currentSource,
            content: yaml.dump(config, { noRefs: true }),
            selection,
        };
    }

    private readSelection() {
        if (!fs.existsSync(this.configPath)) return { adapters: [], protocols: [] };
        const config = parseRuntimeConfig(fs.readFileSync(this.configPath, "utf8"));
        return getRuntimePluginSelection(config) ?? { adapters: [], protocols: [] };
    }

    private installedVersion(packageName: string): string | null {
        const parts = packageName.split("/");
        const manifestPath = path.join(this.runtimeRoot, "node_modules", ...parts, "package.json");
        if (!fs.existsSync(manifestPath)) return null;
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
                version?: unknown;
            };
            return typeof manifest.version === "string" && manifest.version.trim()
                ? manifest.version.trim()
                : null;
        } catch {
            // 损坏或尚未完整写入的清单不应被当作已安装的验证版本。
            return null;
        }
    }

    private requirePackageCatalogEntry(packageName: string) {
        const entry = getExtensionPackageCatalogEntry(packageName);
        if (!entry) throw new Error(`扩展版本目录缺少 ${packageName}`);
        return entry;
    }

    private assertCatalogIntegrity(): void {
        const issues = this.catalogIssues();
        if (issues.length > 0) {
            throw new ExtensionCatalogIntegrityError(
                `扩展目录完整性校验失败，已阻止安装：${issues.join("；")}`,
            );
        }
    }

    private assertRuntimeRoot(): void {
        const manifest = path.join(this.runtimeRoot, "package.json");
        if (!fs.existsSync(manifest)) {
            throw new Error(
                `扩展运行目录缺少 package.json：${this.runtimeRoot}。请使用官方安装脚本部署，或设置 ONEBOTS_EXTENSION_ROOT。`,
            );
        }
    }
}

/** @internal 使用正式重启的隔离预检，并确保含凭据的临时文件被清理。 */
export async function preflightExtensionConfig(
    request: ExtensionConfigPreflightRequest,
    runPreflight: typeof preflightServiceRuntimeIsolated = preflightServiceRuntimeIsolated,
): Promise<void> {
    const targetPath = fs.existsSync(request.configPath)
        ? fs.realpathSync(request.configPath)
        : path.resolve(request.configPath);
    const temporaryPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.preflight`,
    );
    try {
        fs.writeFileSync(temporaryPath, request.content, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
        });
        await runPreflight({
            configPath: temporaryPath,
            adapters: request.selection.adapters,
            protocols: request.selection.protocols,
            workingDirectory: request.runtimeRoot,
        });
    } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
}
