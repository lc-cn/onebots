import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { BaseApp, writeConfigFileAtomic, yaml } from "@onebots/core";
import {
    getTrustedExtensionCatalogEntry,
    TRUSTED_EXTENSION_CATALOG,
} from "./trusted-extension-catalog.js";
import { buildAdapterCapabilityReport, summarizeManifest } from "./capability-report.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionPackageCatalogEntry,
} from "./extension-capability-catalog.js";
import {
    getRuntimePluginSelection,
    setRuntimePluginSelection,
} from "./runtime-plugin-selection.js";
import { formatRuntimeConfigDiagnostic, parseRuntimeConfig } from "./runtime-config-validator.js";
import { inspectPlugin, type LoadedPluginInfo } from "./plugin-loader.js";
import { inspectPackageManifest } from "./package-manifest.js";
import type {
    ExtensionInstallOptions,
    ExtensionRestoreOptions,
    RuntimePackageManagerVersionInspection,
    VerifiedPackageManager,
} from "./package-manager.js";
import type { RuntimePluginSelection } from "./runtime-plugin-selection.js";
import { preflightServiceRuntimeIsolated } from "./service-preflight.js";
import {
    buildExtensionInstallInvocation,
    buildExtensionRestoreInvocation,
    capturePackageManagerMetadata,
    formatPackageManagerDiagnostic,
    hasPackageManagerMetadataChanged,
    inspectRuntimePackageManager,
    inspectRuntimePackageManagerVersion,
    PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
} from "./package-manager.js";
import {
    acquirePackageMutationLock,
    inspectPackageMutationLock,
    PackageMutationLockConflictError,
} from "./package-mutation-lock.js";
import { validateExtensionConfigurationTarget } from "./extension-configuration-target.js";
import { validateExtensionCatalogIntegrity } from "./extension-catalog-integrity.js";
import { inspectExtensionRuntimeRoot } from "./extension-runtime-root.js";

const execFileAsync = promisify(execFile);

export interface ExtensionInstaller {
    install(
        packageName: string,
        packageVersion: string,
        runtimeRoot: string,
        options?: ExtensionInstallOptions,
    ): Promise<void>;
    restore?(
        packageName: string,
        previousVersion: string | null,
        runtimeRoot: string,
        options?: ExtensionRestoreOptions,
    ): Promise<void>;
}

class RuntimeExtensionInstaller implements ExtensionInstaller {
    async install(
        packageName: string,
        packageVersion: string,
        runtimeRoot: string,
        options: ExtensionInstallOptions = {},
    ): Promise<void> {
        const invocation = buildExtensionInstallInvocation(
            runtimeRoot,
            `${packageName}@${packageVersion}`,
            process.platform,
            process.env,
            options,
        );
        await execFileAsync(invocation.executable, invocation.args, {
            cwd: runtimeRoot,
            env: invocation.environment,
            timeout: PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
            maxBuffer: 4 * 1024 * 1024,
        });
    }

    async restore(
        packageName: string,
        previousVersion: string | null,
        runtimeRoot: string,
        options: ExtensionRestoreOptions = {},
    ): Promise<void> {
        const invocation = buildExtensionRestoreInvocation(
            runtimeRoot,
            packageName,
            previousVersion,
            process.platform,
            process.env,
            options,
        );
        await execFileAsync(invocation.executable, invocation.args, {
            cwd: runtimeRoot,
            env: invocation.environment,
            timeout: PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
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
    packageManagerInspector?: (
        runtimeRoot: string,
    ) => Promise<RuntimePackageManagerVersionInspection>;
}

interface InstalledPackageInspection {
    version: string | null;
    error: string | null;
}

export interface ExtensionConfigPreflightRequest {
    content: string;
    selection: RuntimePluginSelection;
    runtimeRoot: string;
    configPath: string;
}

export type ExtensionConfigPreflight = (request: ExtensionConfigPreflightRequest) => Promise<void>;

export type ExtensionInstallationPhase =
    | "installing_package"
    | "preflighting"
    | "restoring_package";

export interface ExtensionInstallationStatus {
    operationId: string;
    phase: ExtensionInstallationPhase;
    startedAt: string;
}

export interface ExtensionInstallationResult {
    operationId: string;
    status: "succeeded" | "failed";
    startedAt: string;
    completedAt: string;
    message: string | null;
}

export interface ExtensionDisableStatus {
    operationId: string;
    startedAt: string;
}

export interface ExtensionDisableResult {
    operationId: string;
    status: "succeeded" | "failed";
    startedAt: string;
    completedAt: string;
    message: string | null;
}

/** 避免把包管理器输出中的常见凭据带回管理端，并限制单条诊断占用。 */
export function formatExtensionInstallationError(error: unknown): string {
    return formatPackageManagerDiagnostic(error);
}

export class ExtensionNotFoundError extends Error {}
export class ExtensionInstallConflictError extends Error {}
export class ExtensionStateConflictError extends Error {}
export class ExtensionCatalogIntegrityError extends Error {}
export class ExtensionRuntimeConfigError extends Error {}

/** 白名单扩展的安装、启用和运行态查询。 */
export class ExtensionManager {
    private readonly runtimeRoot: string;
    private readonly configPath: string;
    private readonly installer: ExtensionInstaller;
    private readonly preflight: ExtensionConfigPreflight;
    private readonly catalogIssues: () => string[];
    private readonly packageManagerInspector: (
        runtimeRoot: string,
    ) => Promise<RuntimePackageManagerVersionInspection>;
    private installation: {
        id: string;
        operationId: string;
        phase: ExtensionInstallationPhase;
        startedAt: string;
        promise: Promise<{ restartRequired: true }>;
    } | null = null;
    private readonly lastInstallations = new Map<string, ExtensionInstallationResult>();
    private disabling: {
        id: string;
        operationId: string;
        startedAt: string;
        promise: Promise<{ restartRequired: true }>;
    } | null = null;
    private readonly lastDisables = new Map<string, ExtensionDisableResult>();

    constructor(options: ExtensionManagerOptions = {}) {
        this.runtimeRoot = path.resolve(
            options.runtimeRoot ?? process.env.ONEBOTS_EXTENSION_ROOT ?? process.cwd(),
        );
        this.configPath = options.configPath ?? BaseApp.configPath;
        this.installer = options.installer ?? new RuntimeExtensionInstaller();
        this.preflight = options.preflight ?? preflightExtensionConfig;
        this.catalogIssues = options.catalogIssues ?? validateExtensionCatalogIntegrity;
        this.packageManagerInspector =
            options.packageManagerInspector ?? inspectRuntimePackageManagerVersion;
    }

    list(loadedPlugins: readonly LoadedPluginInfo[], configSource?: string) {
        let selection: RuntimePluginSelection = { adapters: [], protocols: [] };
        let runtimeConfigError: string | null = null;
        try {
            selection =
                configSource === undefined
                    ? this.readSelection()
                    : this.readSelectionFromSource(configSource);
        } catch (error) {
            runtimeConfigError = formatExtensionRuntimeConfigError(error);
        }
        const catalogIssues = this.catalogIssues();
        const catalogError = catalogIssues.length
            ? `扩展目录完整性校验失败：${catalogIssues.join("；")}`
            : null;
        const runtimeRootError = inspectExtensionRuntimeRoot(this.runtimeRoot).error;
        const packageManagerError = runtimeRootError
            ? null
            : inspectRuntimePackageManager(this.runtimeRoot).error;
        const adapterCapabilities = new Map(
            buildAdapterCapabilityReport(loadedPlugins).adapters.map(adapter => [
                adapter.name,
                {
                    source: "runtime" as const,
                    status: adapter.status,
                    packageVersion: adapter.packageVersion,
                    declared: adapter.declared,
                    summary: adapter.summary,
                    manifest: adapter.capabilities,
                },
            ]),
        );
        return TRUSTED_EXTENSION_CATALOG.map(entry => {
            const packageCatalog = getExtensionPackageCatalogEntry(entry.packageName);
            const installedPackage = this.inspectInstalledPackage(entry.packageName);
            const installedVersion = installedPackage.version;
            const versionAligned =
                packageCatalog !== undefined &&
                installedPackage.error === null &&
                installedVersion === packageCatalog.packageVersion;
            const loadedPlugin = loadedPlugins.find(
                plugin => plugin.type === entry.type && plugin.name === entry.name,
            );
            const loaded = loadedPlugin !== undefined;
            const catalogCapability =
                entry.type === "adapter"
                    ? getExtensionCapabilityCatalogEntry(entry.name)
                    : undefined;
            const installation =
                this.installation?.id === entry.id
                    ? {
                          operationId: this.installation.operationId,
                          phase: this.installation.phase,
                          startedAt: this.installation.startedAt,
                      }
                    : null;
            const disableOperation =
                this.disabling?.id === entry.id
                    ? {
                          operationId: this.disabling.operationId,
                          startedAt: this.disabling.startedAt,
                      }
                    : null;
            return {
                ...entry,
                catalogError,
                runtimeError: runtimeRootError,
                packageManagerError: versionAligned ? null : packageManagerError,
                runtimeConfigError,
                configurationError: validateExtensionConfigurationTarget(entry),
                targetVersion: packageCatalog?.packageVersion ?? null,
                installedVersion,
                installedError: installedPackage.error,
                versionAligned,
                installed: installedVersion !== null,
                enabled: (entry.type === "adapter"
                    ? selection.adapters
                    : selection.protocols
                ).includes(entry.name),
                loaded,
                loadedVersion: loadedPlugin?.version ?? null,
                installing: installation !== null,
                installation,
                lastInstallation: this.lastInstallations.get(entry.id) ?? null,
                disabling: disableOperation !== null,
                disableOperation,
                lastDisable: this.lastDisables.get(entry.id) ?? null,
                capability:
                    entry.type !== "adapter"
                        ? null
                        : loaded
                          ? (adapterCapabilities.get(entry.name) ?? {
                                source: "runtime" as const,
                                status: "unknown" as const,
                                packageVersion: null,
                                declared: false,
                                summary: null,
                                manifest: null,
                            })
                          : !catalogError && catalogCapability
                            ? {
                                  source: "catalog" as const,
                                  status: "verified" as const,
                                  packageVersion: catalogCapability.packageVersion,
                                  declared: true,
                                  summary: summarizeManifest(catalogCapability.manifest),
                                  manifest: catalogCapability.manifest,
                              }
                            : {
                                  source: "catalog" as const,
                                  status: "unavailable" as const,
                                  packageVersion: null,
                                  declared: false,
                                  summary: null,
                                  manifest: null,
                              },
            };
        });
    }

    packageMutationStatus() {
        return inspectPackageMutationLock(this.runtimeRoot);
    }

    async install(id: string): Promise<{ restartRequired: true }> {
        const entry = getTrustedExtensionCatalogEntry(id);
        if (!entry) throw new ExtensionNotFoundError("扩展不存在或不允许从管理端安装");
        if (this.installation) {
            if (this.installation.id === id) return this.installation.promise;
            throw new ExtensionInstallConflictError(
                `扩展 ${this.installation.id} 正在安装，请稍后再试`,
            );
        }
        if (this.disabling) {
            throw new ExtensionInstallConflictError(
                `扩展 ${this.disabling.id} 正在停用，请等待停用完成后再安装扩展`,
            );
        }
        this.assertCatalogIntegrity();
        this.assertRuntimeRoot();
        const packageCatalog = this.requirePackageCatalogEntry(entry.packageName);
        let startInstallation: (() => void) | undefined;
        const startGate = new Promise<void>(resolve => {
            startInstallation = resolve;
        });
        const operationId = randomUUID();
        const startedAt = new Date().toISOString();
        const promise = startGate.then(async (): Promise<{ restartRequired: true }> => {
            let packageLock;
            try {
                packageLock = acquirePackageMutationLock(this.runtimeRoot, {
                    token: randomUUID(),
                    operationId,
                    operation: "extension_install",
                    extensionId: id,
                });
            } catch (error) {
                if (error instanceof PackageMutationLockConflictError) {
                    throw new ExtensionInstallConflictError(error.message, { cause: error });
                }
                throw error;
            }
            let previousPackage: InstalledPackageInspection = { version: null, error: null };
            let previousVersion: string | null = null;
            let packageMetadata: ReturnType<typeof capturePackageManagerMetadata> | null = null;
            let packageManager: VerifiedPackageManager | null = null;
            let packageInstallAttempted = false;
            let packageInstallCompleted = false;
            try {
                previousPackage = this.inspectInstalledPackage(entry.packageName);
                previousVersion = previousPackage.version;
                const repairsCurrentVersion =
                    previousVersion === packageCatalog.packageVersion &&
                    previousPackage.error !== null;
                const packageNeedsInstall =
                    repairsCurrentVersion || previousVersion !== packageCatalog.packageVersion;
                if (packageNeedsInstall) packageManager = await this.assertPackageManager();
                packageMetadata = packageNeedsInstall
                    ? capturePackageManagerMetadata(this.runtimeRoot)
                    : null;
                const preparedConfig = this.prepareConfig(entry.type, entry.name);
                if (packageNeedsInstall) {
                    packageInstallAttempted = true;
                    if (repairsCurrentVersion) {
                        fs.rmSync(
                            path.join(
                                this.runtimeRoot,
                                "node_modules",
                                ...entry.packageName.split("/"),
                            ),
                            { recursive: true, force: true },
                        );
                        await this.installer.install(
                            entry.packageName,
                            packageCatalog.packageVersion,
                            this.runtimeRoot,
                            { force: true, packageManager: packageManager! },
                        );
                    } else {
                        await this.installer.install(
                            entry.packageName,
                            packageCatalog.packageVersion,
                            this.runtimeRoot,
                            { packageManager: packageManager! },
                        );
                    }
                    packageInstallCompleted = true;
                    const installedPackage = this.inspectInstalledPackage(entry.packageName);
                    if (
                        installedPackage.error ||
                        installedPackage.version !== packageCatalog.packageVersion
                    ) {
                        throw new Error(
                            installedPackage.error
                                ? `扩展安装包身份校验失败：${installedPackage.error}`
                                : `扩展安装版本校验失败：${entry.packageName} 期望 ${packageCatalog.packageVersion}，实际 ${installedPackage.version ?? "未安装"}`,
                        );
                    }
                }
                this.setInstallationPhase(operationId, "preflighting");
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
            } catch (error) {
                const packageChanged =
                    packageInstallCompleted ||
                    (packageInstallAttempted &&
                        (this.packageStateChanged(entry.packageName, previousPackage) ||
                            (packageMetadata !== null &&
                                hasPackageManagerMetadataChanged(packageMetadata))));
                if (packageChanged && this.installer.restore) {
                    this.setInstallationPhase(operationId, "restoring_package");
                    await this.restorePackageAfterFailure(
                        entry.packageName,
                        previousVersion,
                        error,
                        packageMetadata,
                        packageManager,
                    );
                }
                throw error;
            } finally {
                packageLock.release();
            }
        });
        this.installation = {
            id,
            operationId,
            phase: "installing_package",
            startedAt,
            promise,
        };
        this.lastInstallations.delete(id);
        startInstallation?.();
        try {
            const result = await promise;
            this.lastInstallations.set(id, {
                operationId,
                status: "succeeded",
                startedAt,
                completedAt: new Date().toISOString(),
                message: null,
            });
            return result;
        } catch (error) {
            this.lastInstallations.set(id, {
                operationId,
                status: "failed",
                startedAt,
                completedAt: new Date().toISOString(),
                message: formatExtensionInstallationError(error),
            });
            throw error;
        } finally {
            if (this.installation?.promise === promise) this.installation = null;
        }
    }

    /**
     * 从下一次启动选择中移除扩展。依赖保留在磁盘，避免配置操作隐式改写包管理器状态。
     * 当前进程仍会继续使用已加载扩展，调用方必须在写入成功后完成一次可验证重启。
     */
    async disable(id: string): Promise<{ restartRequired: true }> {
        const entry = getTrustedExtensionCatalogEntry(id);
        if (!entry) throw new ExtensionNotFoundError("扩展不存在或不允许从管理端停用");
        if (this.installation) {
            throw new ExtensionInstallConflictError(
                `扩展 ${this.installation.id} 正在安装，请等待安装完成后再停用扩展`,
            );
        }
        if (this.disabling) {
            if (this.disabling.id === id) return this.disabling.promise;
            throw new ExtensionInstallConflictError(
                `扩展 ${this.disabling.id} 正在停用，请稍后再试`,
            );
        }

        let startDisable: (() => void) | undefined;
        const startGate = new Promise<void>(resolve => {
            startDisable = resolve;
        });
        const operationId = randomUUID();
        const startedAt = new Date().toISOString();
        const promise = startGate.then(async (): Promise<{ restartRequired: true }> => {
            let packageLock;
            try {
                packageLock = acquirePackageMutationLock(this.runtimeRoot, {
                    token: randomUUID(),
                    operationId,
                    operation: "extension_disable",
                    extensionId: id,
                });
            } catch (error) {
                if (error instanceof PackageMutationLockConflictError) {
                    throw new ExtensionInstallConflictError(error.message, { cause: error });
                }
                throw error;
            }
            try {
                let candidate = this.prepareConfig(entry.type, entry.name, undefined, false);
                for (let attempt = 0; attempt < 3; attempt++) {
                    const latestSource = fs.readFileSync(this.configPath, "utf8");
                    if (latestSource !== candidate.source) {
                        candidate = this.prepareConfig(entry.type, entry.name, latestSource, false);
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
                packageLock.release();
            }
        });
        this.disabling = { id, operationId, startedAt, promise };
        this.lastDisables.delete(id);
        startDisable?.();
        try {
            const result = await promise;
            this.lastDisables.set(id, {
                operationId,
                status: "succeeded",
                startedAt,
                completedAt: new Date().toISOString(),
                message: null,
            });
            return result;
        } catch (error) {
            this.lastDisables.set(id, {
                operationId,
                status: "failed",
                startedAt,
                completedAt: new Date().toISOString(),
                message: formatExtensionInstallationError(error),
            });
            throw error;
        } finally {
            if (this.disabling?.promise === promise) this.disabling = null;
        }
    }

    private setInstallationPhase(operationId: string, phase: ExtensionInstallationPhase): void {
        if (this.installation?.operationId === operationId) this.installation.phase = phase;
    }

    private async restorePackageAfterFailure(
        packageName: string,
        previousVersion: string | null,
        originalError: unknown,
        packageMetadata: ReturnType<typeof capturePackageManagerMetadata> | null,
        packageManager: VerifiedPackageManager | null,
    ): Promise<void> {
        try {
            await this.installer.restore!(packageName, previousVersion, this.runtimeRoot, {
                packageManager: packageManager!,
            });
            const restoredPackage = this.inspectInstalledPackage(packageName);
            if (restoredPackage.error || restoredPackage.version !== previousVersion) {
                throw new Error(
                    restoredPackage.error ??
                        `${packageName} 期望恢复为 ${previousVersion ?? "未安装"}，实际 ${restoredPackage.version ?? "未安装"}`,
                );
            }
            if (packageMetadata && hasPackageManagerMetadataChanged(packageMetadata)) {
                throw new Error("包管理器恢复后依赖声明或锁文件仍与安装前不一致");
            }
        } catch (restoreError) {
            const installMessage = formatExtensionInstallationError(originalError);
            const restoreMessage = formatExtensionInstallationError(restoreError);
            throw new AggregateError(
                [originalError, restoreError],
                `扩展安装失败且依赖恢复失败：安装错误：${installMessage}；恢复错误：${restoreMessage}`,
            );
        }
    }

    /** 包管理器非零退出也可能已改写依赖；只有磁盘证据变化时才启动反向恢复。 */
    private packageStateChanged(
        packageName: string,
        previous: InstalledPackageInspection,
    ): boolean {
        const current = this.inspectInstalledPackage(packageName);
        return current.version !== previous.version || current.error !== previous.error;
    }

    /** 解析当前配置并生成不会丢失其他插件选择的候选内容。 */
    private prepareConfig(
        type: "adapter" | "protocol",
        name: string,
        source?: string,
        enabled = true,
    ) {
        try {
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
            const selected = selection[key].includes(name);
            if (enabled && !selected) selection[key].push(name);
            if (!enabled) {
                if (!selected) {
                    throw new ExtensionStateConflictError(`扩展 ${name} 未在启动配置中启用`);
                }
                selection[key] = selection[key].filter(item => item !== name);
            }
            setRuntimePluginSelection(config, selection);
            return {
                source: currentSource,
                content: yaml.dump(config, { noRefs: true }),
                selection,
            };
        } catch (error) {
            if (
                error instanceof ExtensionRuntimeConfigError ||
                error instanceof ExtensionStateConflictError
            ) {
                throw error;
            }
            throw new ExtensionRuntimeConfigError(formatExtensionRuntimeConfigError(error), {
                cause: error,
            });
        }
    }

    private readSelection() {
        if (!fs.existsSync(this.configPath)) return { adapters: [], protocols: [] };
        return this.readSelectionFromSource(fs.readFileSync(this.configPath, "utf8"));
    }

    private readSelectionFromSource(source: string) {
        const config = parseRuntimeConfig(source);
        return getRuntimePluginSelection(config) ?? { adapters: [], protocols: [] };
    }

    private inspectInstalledPackage(packageName: string): InstalledPackageInspection {
        const parts = packageName.split("/");
        const manifestPath = path.join(this.runtimeRoot, "node_modules", ...parts, "package.json");
        if (!fs.existsSync(manifestPath)) return { version: null, error: null };
        try {
            const manifestInspection = inspectPackageManifest(manifestPath);
            if ("error" in manifestInspection) {
                return { version: null, error: `${packageName} 的 ${manifestInspection.error}` };
            }
            const manifest = manifestInspection.manifest;
            const actualName = typeof manifest.name === "string" ? manifest.name.trim() : "";
            if (actualName !== packageName) {
                return {
                    version: null,
                    error: `${packageName} 的 package.json 包名错配，实际为 ${actualName || "未声明"}`,
                };
            }
            const version =
                typeof manifest.version === "string" && manifest.version.trim()
                    ? manifest.version.trim()
                    : null;
            if (!version) {
                return {
                    version: null,
                    error: `${packageName} 的 package.json 未声明有效版本`,
                };
            }
            const inspection = inspectPlugin(
                [packageName],
                createRequire(path.join(this.runtimeRoot, "package.json")),
            );
            if (inspection.status !== "ready") {
                const reason =
                    inspection.status === "broken"
                        ? inspection.reason
                        : `无法从运行目录解析 ${packageName}`;
                return {
                    version,
                    error: `${packageName} 的插件入口无法验证：${reason}`,
                };
            }
            return {
                version,
                error: null,
            };
        } catch {
            // 不回显底层异常，避免损坏依赖把不受信任的诊断带到管理端。
            return {
                version: null,
                error: `${packageName} 的依赖无法验证`,
            };
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
        const error = inspectExtensionRuntimeRoot(this.runtimeRoot).error;
        if (error) throw new Error(error);
    }

    private async assertPackageManager(): Promise<VerifiedPackageManager> {
        const inspection = await this.packageManagerInspector(this.runtimeRoot);
        if (inspection.error) throw new Error(inspection.error);
        if (!inspection.manager || !inspection.resolvedPath) {
            throw new Error("扩展包管理器校验未返回可执行入口");
        }
        return {
            manager: inspection.manager,
            resolvedPath: inspection.resolvedPath,
        };
    }
}

/** 只公开解析原因首行，避免 YAML 代码片段把相邻凭据带到扩展目录。 */
export function formatExtensionRuntimeConfigError(error: unknown): string {
    return `扩展启动配置无法读取：${formatRuntimeConfigDiagnostic(error)}`;
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
