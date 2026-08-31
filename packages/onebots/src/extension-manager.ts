import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BaseApp, writeConfigFileAtomic, yaml } from "@onebots/core";
import { EXTENSION_CATALOG, getExtensionCatalogEntry } from "./extension-catalog.js";
import { buildAdapterCapabilityReport } from "./capability-report.js";
import {
    getRuntimePluginSelection,
    setRuntimePluginSelection,
} from "./runtime-plugin-selection.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import type { LoadedPluginInfo } from "./plugin-loader.js";
import type { RuntimePluginSelection } from "./runtime-plugin-selection.js";
import { preflightServiceRuntimeIsolated } from "./service-preflight.js";

const execFileAsync = promisify(execFile);

export interface ExtensionInstaller {
    install(packageName: string, runtimeRoot: string): Promise<void>;
}

class NpmExtensionInstaller implements ExtensionInstaller {
    async install(packageName: string, runtimeRoot: string): Promise<void> {
        await execFileAsync(
            process.platform === "win32" ? "npm.cmd" : "npm",
            ["install", "--save", "--omit=dev", `${packageName}@latest`],
            { cwd: runtimeRoot, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
        );
    }
}

export interface ExtensionManagerOptions {
    runtimeRoot?: string;
    configPath?: string;
    installer?: ExtensionInstaller;
    preflight?: ExtensionConfigPreflight;
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

/** 白名单扩展的安装、启用和运行态查询。 */
export class ExtensionManager {
    private readonly runtimeRoot: string;
    private readonly configPath: string;
    private readonly installer: ExtensionInstaller;
    private readonly preflight: ExtensionConfigPreflight;
    private installing: string | null = null;

    constructor(options: ExtensionManagerOptions = {}) {
        this.runtimeRoot = path.resolve(
            options.runtimeRoot ?? process.env.ONEBOTS_EXTENSION_ROOT ?? process.cwd(),
        );
        this.configPath = options.configPath ?? BaseApp.configPath;
        this.installer = options.installer ?? new NpmExtensionInstaller();
        this.preflight = options.preflight ?? preflightExtensionConfig;
    }

    list(loadedPlugins: readonly LoadedPluginInfo[]) {
        const selection = this.readSelection();
        const adapterCapabilities = new Map(
            buildAdapterCapabilityReport(loadedPlugins).adapters.map(adapter => [
                adapter.name,
                {
                    declared: adapter.declared,
                    summary: adapter.summary,
                    manifest: adapter.capabilities,
                },
            ]),
        );
        return EXTENSION_CATALOG.map(entry => {
            const loaded = loadedPlugins.some(
                plugin => plugin.type === entry.type && plugin.name === entry.name,
            );
            return {
                ...entry,
                installed: this.isInstalled(entry.packageName),
                enabled: (entry.type === "adapter"
                    ? selection.adapters
                    : selection.protocols
                ).includes(entry.name),
                loaded,
                installing: this.installing === entry.id,
                capability:
                    entry.type === "adapter" && loaded
                        ? (adapterCapabilities.get(entry.name) ?? {
                              declared: false,
                              summary: null,
                              manifest: null,
                          })
                        : null,
            };
        });
    }

    async install(id: string): Promise<{ restartRequired: true }> {
        const entry = getExtensionCatalogEntry(id);
        if (!entry) throw new ExtensionNotFoundError("扩展不存在或不允许从管理端安装");
        if (this.installing) {
            throw new ExtensionInstallConflictError(`扩展 ${this.installing} 正在安装，请稍后再试`);
        }
        this.assertRuntimeRoot();
        const preparedConfig = this.prepareConfig(entry.type, entry.name);
        this.installing = id;
        try {
            if (!this.isInstalled(entry.packageName)) {
                await this.installer.install(entry.packageName, this.runtimeRoot);
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
        } finally {
            this.installing = null;
        }
    }

    /** 在调用 npm 前验证配置，并生成不会丢失现有插件选择的候选内容。 */
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

    private isInstalled(packageName: string): boolean {
        const parts = packageName.split("/");
        return fs.existsSync(path.join(this.runtimeRoot, "node_modules", ...parts, "package.json"));
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
