import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    buildServiceArgs,
    ServiceController,
    type ServiceScope,
    type ServiceSpec,
} from "./service-manager.js";
import { writeCliOutput } from "./cli-output.js";
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import {
    buildPackageManagerInvocation,
    buildPackageUpdateInvocation,
    capturePackageManagerMetadata,
    formatPackageManagerDiagnostic,
    hasPackageManagerMetadataChanged,
    inspectRuntimePackageManagerVersion,
    isExactPackageVersion,
    PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
    type PackageInstallInvocation,
    type RuntimePackageManagerVersionInspection,
    type VerifiedPackageManager,
} from "./package-manager.js";
import { acquirePackageMutationLock } from "./package-mutation-lock.js";
import { readServiceInstanceId, verifyServiceOnline } from "./service-online-verification.js";
import { inspectExtensionRuntimeRoot } from "./extension-runtime-root.js";
import {
    assertUpdatedPackageVersions,
    recoverPackagesAfterFailedUpdate,
    rollbackUpdatedPackages,
    type PackageUpdateEvidence,
} from "./update-package-transaction.js";
import {
    loadTargetExtensionVersionCatalog as loadVersionCatalog,
    resolveVerifiedUpdateTargets,
    type ExtensionVersionCatalogSnapshot,
} from "./update-extension-catalog.js";
import { inspectPackageManifest } from "./package-manifest.js";

export { resolveVerifiedUpdateTargets } from "./update-extension-catalog.js";

export interface UpdateOptions {
    adapters: string[];
    protocols: string[];
    scope: ServiceScope;
    check?: boolean;
    yes?: boolean;
    /** 只同步当前项目依赖，不读取、改写或重启系统服务。 */
    packagesOnly?: boolean;
    /** packagesOnly 可用它读取配置中持久化的插件选择。 */
    configPath?: string;
}

export interface PackageUpdateChange extends PackageUpdateEvidence {
    current: string | null;
}

export const PACKAGE_VERSION_QUERY_TIMEOUT_MS = 30_000;
export const PACKAGE_VERSION_QUERY_MAX_BUFFER_BYTES = 64 * 1024;

export interface PackageVersionQueryRequest extends PackageInstallInvocation {
    cwd: string;
    timeout: number;
    maxBuffer: number;
}

export type PackageVersionQueryRunner = (request: PackageVersionQueryRequest) => string;

interface UpdatePluginSelection {
    adapters: string[];
    protocols: string[];
}

interface PackagesOnlyPreflightDependencies {
    preflight(spec: ServiceSpec): void | Promise<void>;
    rollback(): void | Promise<void>;
}

export type UpdateRunResult =
    | { status: "current"; changes: [] }
    | { status: "updates_available" | "updated" | "cancelled"; changes: PackageUpdateChange[] };

/** 将 adapter/protocol 短名转换为可更新的 npm 包名列表。 */
export function packageNamesFor(adapters: string[], protocols: string[]): string[] {
    return [
        ...new Set([
            "onebots",
            ...adapters.map(name => `@onebots/adapter-${name}`),
            ...protocols.map(name => `@onebots/protocol-${name}`),
        ]),
    ];
}

/** 显式更新参数优先，其次使用当前配置，最后兼容旧服务保存的启动快照。 */
export function resolveUpdatePluginSelection(
    options: Pick<UpdateOptions, "adapters" | "protocols">,
    spec: ServiceSpec | null,
    configPath?: string,
): { adapters: string[]; protocols: string[] } {
    const selectionPath = configPath ?? spec?.configPath;
    const configured =
        selectionPath && fs.existsSync(selectionPath)
            ? getRuntimePluginSelection(parseRuntimeConfig(fs.readFileSync(selectionPath, "utf8")))
            : undefined;
    return {
        adapters: options.adapters.length
            ? options.adapters
            : (configured?.adapters ?? spec?.adapters ?? []),
        protocols: options.protocols.length
            ? options.protocols
            : (configured?.protocols ?? spec?.protocols ?? []),
    };
}

/** packages-only 模式始终以当前目录为目标，并与已安装服务彻底解耦。 */
export function resolveUpdateRuntimeTarget(
    packagesOnly: boolean | undefined,
    installedSpec: ServiceSpec | null,
    currentDirectory = process.cwd(),
): { spec: ServiceSpec | null; runtimeRoot: string } {
    return packagesOnly
        ? { spec: null, runtimeRoot: currentDirectory }
        : {
              spec: installedSpec,
              runtimeRoot: installedSpec?.workingDirectory ?? currentDirectory,
          };
}

/** 更新查询与写事务必须使用已经执行并通过版本下限验证的包管理器入口。 */
export async function requireUpdatePackageManager(
    runtimeRoot: string,
    inspect: (
        target: string,
    ) => Promise<RuntimePackageManagerVersionInspection> = inspectRuntimePackageManagerVersion,
): Promise<VerifiedPackageManager> {
    const inspection = await inspect(runtimeRoot);
    if (inspection.error || !inspection.manager || !inspection.version) {
        throw new Error(`更新包管理器不可用：${inspection.error ?? "无法确认实际版本"}`);
    }
    if (!inspection.resolvedPath) {
        throw new Error("更新包管理器不可用：无法确认已验证的可执行入口");
    }
    return { manager: inspection.manager, resolvedPath: inspection.resolvedPath };
}

/** 检查并更新 OneBots 与当前服务使用的插件。 */
export async function runUpdate(options: UpdateOptions): Promise<UpdateRunResult> {
    if (options.packagesOnly && (!options.configPath || !fs.existsSync(options.configPath))) {
        throw new Error("--packages-only 需要可读取的配置文件，以便在保留新依赖前完成隔离预检");
    }
    const controller = new ServiceController(options.scope);
    const installedSpec = options.packagesOnly ? null : controller.readSpec();
    const { spec, runtimeRoot } = resolveUpdateRuntimeTarget(options.packagesOnly, installedSpec);
    const { adapters, protocols } = resolveUpdatePluginSelection(
        options,
        options.packagesOnly ? null : installedSpec,
        options.packagesOnly ? options.configPath : undefined,
    );
    const packages = packageNamesFor(adapters, protocols);
    const manager = await requireUpdatePackageManager(runtimeRoot);
    const targetOnebotsVersion = queryLatestPackageVersion(manager, "onebots", runtimeRoot);
    const targetCatalog = loadTargetExtensionVersionCatalog(
        manager,
        runtimeRoot,
        targetOnebotsVersion,
    );
    const targets = resolveVerifiedUpdateTargets(packages, targetOnebotsVersion, targetCatalog);
    let updates: PackageUpdateChange[] = [];
    let changed: PackageUpdateChange[] = [];
    const evidenceLock = acquireUpdatePackageMutationLock(runtimeRoot);
    try {
        const lockedSelection = resolveUpdatePluginSelection(
            options,
            options.packagesOnly ? null : installedSpec,
            options.packagesOnly ? options.configPath : undefined,
        );
        assertUpdatePluginSelectionUnchanged({ adapters, protocols }, lockedSelection);
        updates = refreshUpdatePackageSnapshots(targets, runtimeRoot);
        for (const item of updates) {
            writeCliOutput(`${item.name}: ${item.current ?? "未安装"} -> ${item.target}`);
        }
        changed = updates.filter(item => item.current !== item.target);
        if (!changed.length) {
            if (options.packagesOnly) {
                await preflightCurrentPackagesOnlyRuntime({
                    scope: options.scope,
                    configPath: path.resolve(options.configPath!),
                    adapters,
                    protocols,
                    nodePath: process.execPath,
                    binPath: path.resolve(process.argv[1]),
                    workingDirectory: runtimeRoot,
                });
            }
            writeCliOutput("已是最新稳定版本");
            return { status: "current", changes: [] };
        }
        if (options.check) return { status: "updates_available", changes: changed };
    } finally {
        evidenceLock.release();
    }

    if (!options.yes) {
        if (!process.stdin.isTTY) throw new Error("非交互环境执行更新需要 --yes");
        const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
            const answer = (
                await prompt.question(`更新 ${changed.length} 个包并修改锁文件？ [y/N] `)
            )
                .trim()
                .toLowerCase();
            if (answer !== "y" && answer !== "yes") {
                writeCliOutput("已取消");
                return { status: "cancelled", changes: changed };
            }
        } finally {
            prompt.close();
        }
    }

    if (isEphemeralNpx()) {
        const command =
            manager.manager === "pnpm"
                ? `pnpm add ${changed.map(item => `${item.name}@${item.target}`).join(" ")}`
                : `npm install ${changed.map(item => `${item.name}@${item.target}`).join(" ")}`;
        throw new Error(`当前从 npx 临时缓存运行，无法安全自更新。请在项目中执行: ${command}`);
    }
    const initialServiceStatus = spec ? controller.status(spec) : null;
    if (initialServiceStatus?.error) {
        throw new Error(
            `无法确认更新前服务状态，未修改软件包：${initialServiceStatus.error}${initialServiceStatus.detail ? `：${initialServiceStatus.detail}` : ""}`,
        );
    }
    const packageLock = acquireUpdatePackageMutationLock(runtimeRoot);
    try {
        const lockedSelection = resolveUpdatePluginSelection(
            options,
            options.packagesOnly ? null : installedSpec,
            options.packagesOnly ? options.configPath : undefined,
        );
        assertUpdatePluginSelectionUnchanged({ adapters, protocols }, lockedSelection);
        const lockedUpdates = refreshUpdatePackageSnapshots(updates, runtimeRoot);
        const lockedChanged = lockedUpdates.filter(item => item.current !== item.target);
        if (!lockedChanged.length) {
            if (options.packagesOnly) {
                await preflightCurrentPackagesOnlyRuntime({
                    scope: options.scope,
                    configPath: path.resolve(options.configPath!),
                    adapters,
                    protocols,
                    nodePath: process.execPath,
                    binPath: path.resolve(process.argv[1]),
                    workingDirectory: runtimeRoot,
                });
            }
            writeCliOutput("依赖在确认期间已更新到目标版本");
            return { status: "current", changes: [] };
        }
        const projectRoot = resolvePackageUpdateProjectRoot(runtimeRoot);
        const invocation = buildPackageUpdateInvocation(
            runtimeRoot,
            lockedChanged.map(item => `${item.name}@${item.target}`),
            projectRoot,
            process.platform,
            process.env,
            manager,
        );
        const packageMetadata = projectRoot ? capturePackageManagerMetadata(projectRoot) : null;
        try {
            execFileSync(invocation.executable, invocation.args, {
                cwd: invocation.cwd,
                env: invocation.environment,
                stdio: "inherit",
                timeout: PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
            });
        } catch (error) {
            recoverPackagesAfterFailedUpdate(
                lockedUpdates,
                runtimeRoot,
                projectRoot,
                resolveInstalledPackageVersion,
                error,
                {
                    metadataChanged:
                        packageMetadata !== null &&
                        hasPackageManagerMetadataChanged(packageMetadata),
                    verifyMetadata:
                        packageMetadata === null
                            ? undefined
                            : () => {
                                  if (hasPackageManagerMetadataChanged(packageMetadata)) {
                                      throw new Error(
                                          "包管理器恢复后依赖声明或锁文件仍与更新前不一致",
                                      );
                                  }
                              },
                    packageManager: manager,
                },
            );
        }
        try {
            assertUpdatedPackageVersions(
                lockedUpdates,
                runtimeRoot,
                resolveInstalledPackageVersion,
            );
        } catch (error) {
            rollbackPackagesBeforeServiceSwitch(
                lockedUpdates,
                runtimeRoot,
                projectRoot,
                manager,
                error,
            );
        }
        if (options.packagesOnly) {
            await preflightPackagesOnlyUpdate(
                {
                    scope: options.scope,
                    configPath: path.resolve(options.configPath!),
                    adapters,
                    protocols,
                    nodePath: process.execPath,
                    binPath: path.resolve(process.argv[1]),
                    workingDirectory: runtimeRoot,
                },
                {
                    preflight: runUpdatedServicePreflight,
                    rollback: () =>
                        rollbackUpdatedPackages(
                            lockedUpdates,
                            runtimeRoot,
                            projectRoot,
                            resolveInstalledPackageVersion,
                            undefined,
                            manager,
                        ),
                },
            );
        }
        if (spec) {
            const result = await refreshServiceAfterUpdate(
                controller,
                {
                    ...spec,
                    nodePath: process.execPath,
                    binPath: path.resolve(process.argv[1]),
                },
                {
                    expectedVersion: targetOnebotsVersion,
                    yes: options.yes,
                    initiallyRunning: initialServiceStatus?.running,
                    recoverPreflightFailure: () =>
                        rollbackUpdatedPackages(
                            lockedUpdates,
                            runtimeRoot,
                            projectRoot,
                            resolveInstalledPackageVersion,
                            undefined,
                            manager,
                        ),
                },
            );
            if (result.wasRunning && !result.restarted) {
                writeCliOutput("软件包已更新，但运行中的旧实例尚未重启；请执行 onebots restart");
                return { status: "updated", changes: lockedChanged };
            }
        }
        writeCliOutput(
            options.packagesOnly
                ? "OneBots 及已选插件依赖同步完成；未修改或重启服务"
                : "OneBots 及插件更新完成",
        );
        return { status: "updated", changes: lockedChanged };
    } finally {
        packageLock.release();
    }
}

/** 取得写租约后重读包版本，确保失败恢复不会使用确认前的陈旧基线。 */
export function refreshUpdatePackageSnapshots<T extends PackageUpdateEvidence>(
    updates: readonly T[],
    runtimeRoot: string,
    resolveVersion: (name: string, root: string) => string | null = resolveInstalledPackageVersion,
): Array<T & PackageUpdateChange> {
    return updates.map(item => ({
        ...item,
        current: resolveVersion(item.name, runtimeRoot),
    }));
}

/** 写租约内的插件选择必须仍与用户确认的更新计划一致。 */
export function assertUpdatePluginSelectionUnchanged(
    planned: UpdatePluginSelection,
    current: UpdatePluginSelection,
): void {
    if (
        sameStringList(planned.adapters, current.adapters) &&
        sameStringList(planned.protocols, current.protocols)
    ) {
        return;
    }
    throw new Error("插件选择在更新确认期间发生变化；未修改依赖，请重新运行 onebots update");
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** 为 CLI 更新取得与 Web 扩展安装共享的运行目录租约。 */
export function acquireUpdatePackageMutationLock(
    runtimeRoot: string,
    operationId: string = randomUUID(),
) {
    return acquirePackageMutationLock(runtimeRoot, {
        token: randomUUID(),
        operationId,
        operation: "package_update",
    });
}

/** 未发生包变更时仍验证整组依赖，避免安装器过早提交主包升级。 */
export async function preflightCurrentPackagesOnlyRuntime(
    spec: ServiceSpec,
    preflight: (target: ServiceSpec) => void | Promise<void> = runUpdatedServicePreflight,
): Promise<void> {
    try {
        await preflight(spec);
    } catch (error) {
        throw new Error(
            `当前依赖隔离预检失败；未修改依赖、服务定义或运行实例：${errorMessage(error)}`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
}

/** packages-only 更新只有通过真实配置预检后才会保留新依赖。 */
export async function preflightPackagesOnlyUpdate(
    spec: ServiceSpec,
    dependencies: PackagesOnlyPreflightDependencies,
): Promise<void> {
    try {
        await dependencies.preflight(spec);
    } catch (error) {
        try {
            await dependencies.rollback();
        } catch (rollbackError) {
            throw packageRollbackAggregate(error, rollbackError);
        }
        throw new Error(
            `新依赖隔离预检失败，已恢复更新前依赖；服务定义与当前运行实例保持不变：${errorMessage(error)}`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
}

function rollbackPackagesBeforeServiceSwitch(
    changes: readonly PackageUpdateChange[],
    runtimeRoot: string,
    projectRoot: string | null,
    packageManager: VerifiedPackageManager,
    originalError: unknown,
): never {
    try {
        rollbackUpdatedPackages(
            changes,
            runtimeRoot,
            projectRoot,
            resolveInstalledPackageVersion,
            undefined,
            packageManager,
        );
    } catch (rollbackError) {
        throw packageRollbackAggregate(originalError, rollbackError);
    }
    throw new Error(
        `包更新版本校验失败，已恢复更新前依赖；服务定义与当前运行实例保持不变：${errorMessage(originalError)}`,
        { cause: originalError instanceof Error ? originalError : undefined },
    );
}

interface UpdateServiceController {
    status(spec?: ServiceSpec): { running: boolean; detail?: string; error?: string };
    install(spec: ServiceSpec): Promise<void>;
    restart(): Promise<void>;
}

interface RefreshServiceDependencies {
    preflight(spec: ServiceSpec): void | Promise<void>;
    confirmRestart(): Promise<boolean>;
    readInstanceId(spec: ServiceSpec): Promise<string | null>;
    verifyOnline(
        spec: ServiceSpec,
        expectedVersion: string,
        previousInstanceId: string | null,
    ): Promise<void>;
}

interface RefreshServiceOptions {
    expectedVersion: string;
    yes?: boolean;
    /** runUpdate 在修改依赖前取得的权威进程状态，避免变更后再次查询产生竞态。 */
    initiallyRunning?: boolean;
    recoverPreflightFailure?: () => void | Promise<void>;
    dependencies?: RefreshServiceDependencies;
}

export interface RefreshServiceResult {
    wasRunning: boolean;
    restarted: boolean;
    onlineVerified: boolean;
}

/** 软件包更新后先用新 CLI 子进程预检，再改写服务定义和选择性重启。 */
export async function refreshServiceAfterUpdate(
    controller: UpdateServiceController,
    spec: ServiceSpec,
    options: RefreshServiceOptions,
): Promise<RefreshServiceResult> {
    const dependencies = options.dependencies ?? {
        preflight: runUpdatedServicePreflight,
        confirmRestart,
        readInstanceId: readServiceInstanceId,
        verifyOnline: (targetSpec, expectedVersion, previousInstanceId) =>
            verifyServiceOnline(targetSpec, expectedVersion, { previousInstanceId }),
    };
    const serviceStatus =
        options.initiallyRunning === undefined
            ? controller.status()
            : { running: options.initiallyRunning };
    if (serviceStatus.error) {
        const statusError = new Error(
            `${serviceStatus.error}${serviceStatus.detail ? `：${serviceStatus.detail}` : ""}`,
        );
        if (options.recoverPreflightFailure) {
            try {
                await options.recoverPreflightFailure();
            } catch (rollbackError) {
                throw packageRollbackAggregate(statusError, rollbackError);
            }
        }
        throw new Error(
            `${options.recoverPreflightFailure ? "无法确认更新前服务状态，已恢复更新前依赖" : "无法确认更新前服务状态"}；服务定义与当前运行实例保持不变：${statusError.message}`,
            { cause: statusError },
        );
    }
    const wasRunning = serviceStatus.running;
    try {
        await dependencies.preflight(spec);
    } catch (error) {
        if (options.recoverPreflightFailure) {
            try {
                await options.recoverPreflightFailure();
            } catch (rollbackError) {
                throw packageRollbackAggregate(error, rollbackError);
            }
        }
        throw new Error(
            `${options.recoverPreflightFailure ? "新运行环境预检失败，已恢复更新前依赖" : "软件包已更新，但新运行环境预检失败"}；服务定义与当前运行实例保持不变：${errorMessage(error)}`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
    await controller.install(spec);
    if (!wasRunning) return { wasRunning, restarted: false, onlineVerified: false };
    if (!options.yes && !(await dependencies.confirmRestart())) {
        return { wasRunning, restarted: false, onlineVerified: false };
    }
    const previousInstanceId = await dependencies.readInstanceId(spec);
    await controller.restart();
    try {
        await dependencies.verifyOnline(spec, options.expectedVersion, previousInstanceId);
    } catch (error) {
        throw new Error(
            `软件包与服务定义已更新，服务也已重启，但在线验证失败：${error instanceof Error ? error.message : String(error)}；请运行 onebots status 并检查服务日志`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
    return { wasRunning, restarted: true, onlineVerified: true };
}

function packageRollbackAggregate(originalError: unknown, rollbackError: unknown): AggregateError {
    return new AggregateError(
        [originalError, rollbackError],
        `软件包更新失败且依赖恢复失败：更新错误：${errorMessage(originalError)}；恢复错误：${errorMessage(rollbackError)}；服务定义与当前运行实例保持不变`,
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 使用更新后的 Node/CLI 路径，在服务实际工作目录中运行隔离预检。 */
export function runUpdatedServicePreflight(spec: ServiceSpec): void {
    try {
        execFileSync(spec.nodePath, buildServiceArgs(spec, "preflight"), {
            cwd: spec.workingDirectory,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 60_000,
        });
    } catch (error) {
        const stderr =
            error && typeof error === "object" && "stderr" in error
                ? String(error.stderr).trim()
                : "";
        throw new Error(stderr || (error instanceof Error ? error.message : String(error)), {
            cause: error instanceof Error ? error : undefined,
        });
    }
}

export function resolveInstalledPackageVersion(
    name: string,
    runtimeRoot: string,
    cliEntry = process.argv[1],
): string | null {
    const packageParts = name.split("/");
    const origins = [runtimeRoot];
    if (cliEntry) {
        try {
            origins.push(fs.realpathSync(cliEntry));
        } catch {
            origins.push(path.resolve(cliEntry));
        }
    }
    const visited = new Set<string>();
    for (const origin of origins) {
        let current =
            fs.existsSync(origin) && fs.statSync(origin).isDirectory()
                ? path.resolve(origin)
                : path.dirname(path.resolve(origin));
        while (!visited.has(current)) {
            visited.add(current);
            for (const manifest of [
                path.join(current, "node_modules", ...packageParts, "package.json"),
                path.join(current, ...packageParts, "package.json"),
                path.join(current, "package.json"),
            ]) {
                const version = readPackageVersion(manifest, name);
                if (version) return version;
            }
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }
    return null;
}

function readPackageVersion(manifest: string, expectedName: string): string | null {
    if (!fs.existsSync(manifest)) return null;
    const inspection = inspectPackageManifest(manifest);
    if ("error" in inspection) return null;
    const parsed = inspection.manifest;
    return parsed.name === expectedName &&
        typeof parsed.version === "string" &&
        parsed.version.trim()
        ? parsed.version.trim()
        : null;
}

/** 从当前安装或隔离暂存的目标 OneBots 包读取版本目录。 */
export function loadTargetExtensionVersionCatalog(
    packageManager: VerifiedPackageManager,
    runtimeRoot: string,
    onebotsVersion: string,
): ExtensionVersionCatalogSnapshot {
    const installedVersion = resolveInstalledPackageVersion("onebots", runtimeRoot);
    return loadVersionCatalog(
        packageManager,
        runtimeRoot,
        onebotsVersion,
        installedVersion,
        process.argv[1],
    );
}

/** 通过已验证入口执行有界 registry 查询，并只接受单行精确 SemVer 证据。 */
export function queryLatestPackageVersion(
    packageManager: VerifiedPackageManager,
    name: string,
    runtimeRoot: string,
    run: PackageVersionQueryRunner = runPackageVersionQuery,
): string {
    const invocation = buildPackageManagerInvocation(
        packageManager.manager,
        ["view", name, "version"],
        process.platform,
        process.env,
        packageManager.resolvedPath,
    );
    let output: string;
    try {
        output = run({
            ...invocation,
            cwd: runtimeRoot,
            timeout: PACKAGE_VERSION_QUERY_TIMEOUT_MS,
            maxBuffer: PACKAGE_VERSION_QUERY_MAX_BUFFER_BYTES,
        });
    } catch (error) {
        const rawDetail =
            error && typeof error === "object" && "stderr" in error
                ? String(error.stderr)
                : error instanceof Error
                  ? error.message
                  : String(error);
        throw new Error(`无法查询包版本 ${name}：${formatPackageManagerDiagnostic(rawDetail)}`);
    }
    const version = output.endsWith("\r\n")
        ? output.slice(0, -2)
        : output.endsWith("\n")
          ? output.slice(0, -1)
          : output;
    if (!isExactPackageVersion(version)) {
        throw new Error(
            `registry 返回的 ${name} 版本不是精确 SemVer：${formatPackageManagerDiagnostic(output)}`,
        );
    }
    return version;
}

function runPackageVersionQuery(request: PackageVersionQueryRequest): string {
    return execFileSync(request.executable, request.args, {
        cwd: request.cwd,
        encoding: "utf8",
        env: request.environment,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: request.timeout,
        maxBuffer: request.maxBuffer,
    });
}

function isEphemeralNpx(): boolean {
    return /[\\/]_npx[\\/]/.test(process.argv[1] || "");
}

/**
 * 只把能够证明当前 OneBots 安装身份的目录作为项目更新目标。
 * 普通 @onebots/core 消费者不能因为共享核心类型而被写入网关与插件依赖。
 */
export function resolvePackageUpdateProjectRoot(from: string): string | null {
    let current = path.resolve(from);
    let invalidManifest: string | null = null;
    while (true) {
        const manifest = path.join(current, "package.json");
        if (fs.existsSync(manifest)) {
            const manifestInspection = inspectPackageManifest(manifest);
            if ("error" in manifestInspection) {
                invalidManifest ??= manifest;
            } else {
                const parsed = manifestInspection.manifest;
                if (
                    parsed.name === "onebots" ||
                    declaresDependency(parsed.dependencies, "onebots") ||
                    declaresDependency(parsed.devDependencies, "onebots") ||
                    declaresDependency(parsed.optionalDependencies, "onebots")
                ) {
                    const inspection = inspectExtensionRuntimeRoot(current);
                    if (inspection.error) {
                        throw new Error(`项目更新目录无法验证：${inspection.error}`);
                    }
                    return current;
                }
            }
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    if (invalidManifest) {
        throw new Error(`无法确定项目更新目录：package.json 无法读取或解析：${invalidManifest}`);
    }
    return null;
}

function declaresDependency(value: unknown, packageName: string): boolean {
    return typeof value === "object" && value !== null && Object.hasOwn(value, packageName);
}

async function confirmRestart(): Promise<boolean> {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await prompt.question("服务正在运行，立即重启？ [y/N] "))
            .trim()
            .toLowerCase();
        return answer === "y" || answer === "yes";
    } finally {
        prompt.close();
    }
}
