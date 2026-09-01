import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
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
    detectRuntimePackageManager,
    hasPackageManagerMetadataChanged,
} from "./package-manager.js";
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
    const manager = detectRuntimePackageManager(runtimeRoot);
    const targetOnebotsVersion = latestVersion(manager, "onebots");
    if (!targetOnebotsVersion) throw new Error("无法查询包版本: onebots");
    const targetCatalog = loadTargetExtensionVersionCatalog(
        manager,
        runtimeRoot,
        targetOnebotsVersion,
    );
    const updates = resolveVerifiedUpdateTargets(packages, targetOnebotsVersion, targetCatalog).map(
        item => ({
            ...item,
            current: resolveInstalledPackageVersion(item.name, runtimeRoot),
        }),
    );
    for (const item of updates) {
        writeCliOutput(`${item.name}: ${item.current ?? "未安装"} -> ${item.target}`);
    }
    const changed = updates.filter(item => item.current !== item.target);
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
            manager === "pnpm"
                ? `pnpm add ${changed.map(item => `${item.name}@${item.target}`).join(" ")}`
                : `npm install ${changed.map(item => `${item.name}@${item.target}`).join(" ")}`;
        throw new Error(`当前从 npx 临时缓存运行，无法安全自更新。请在项目中执行: ${command}`);
    }
    const names = changed.map(item => `${item.name}@${item.target}`);
    const projectRoot = resolvePackageUpdateProjectRoot(runtimeRoot);
    const invocation = buildPackageUpdateInvocation(runtimeRoot, names, projectRoot);
    const packageMetadata = projectRoot ? capturePackageManagerMetadata(projectRoot) : null;
    const initialServiceStatus = spec ? controller.status(spec) : null;
    if (initialServiceStatus?.error) {
        throw new Error(
            `无法确认更新前服务状态，未修改软件包：${initialServiceStatus.error}${initialServiceStatus.detail ? `：${initialServiceStatus.detail}` : ""}`,
        );
    }
    try {
        execFileSync(invocation.executable, invocation.args, {
            cwd: invocation.cwd,
            env: invocation.environment,
            stdio: "inherit",
        });
    } catch (error) {
        recoverPackagesAfterFailedUpdate(
            updates,
            runtimeRoot,
            projectRoot,
            resolveInstalledPackageVersion,
            error,
            {
                metadataChanged:
                    packageMetadata !== null && hasPackageManagerMetadataChanged(packageMetadata),
                verifyMetadata:
                    packageMetadata === null
                        ? undefined
                        : () => {
                              if (hasPackageManagerMetadataChanged(packageMetadata)) {
                                  throw new Error("包管理器恢复后依赖声明或锁文件仍与更新前不一致");
                              }
                          },
            },
        );
    }
    try {
        assertUpdatedPackageVersions(updates, runtimeRoot, resolveInstalledPackageVersion);
    } catch (error) {
        rollbackPackagesBeforeServiceSwitch(updates, runtimeRoot, projectRoot, error);
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
                        updates,
                        runtimeRoot,
                        projectRoot,
                        resolveInstalledPackageVersion,
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
                        updates,
                        runtimeRoot,
                        projectRoot,
                        resolveInstalledPackageVersion,
                    ),
            },
        );
        if (result.wasRunning && !result.restarted) {
            writeCliOutput("软件包已更新，但运行中的旧实例尚未重启；请执行 onebots restart");
            return { status: "updated", changes: changed };
        }
    }
    writeCliOutput(
        options.packagesOnly
            ? "OneBots 及已选插件依赖同步完成；未修改或重启服务"
            : "OneBots 及插件更新完成",
    );
    return { status: "updated", changes: changed };
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
    originalError: unknown,
): never {
    try {
        rollbackUpdatedPackages(changes, runtimeRoot, projectRoot, resolveInstalledPackageVersion);
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
    try {
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
            name?: unknown;
            version?: unknown;
        };
        return parsed.name === expectedName &&
            typeof parsed.version === "string" &&
            parsed.version.trim()
            ? parsed.version.trim()
            : null;
    } catch {
        return null;
    }
}

/** 从当前安装或隔离暂存的目标 OneBots 包读取版本目录。 */
export function loadTargetExtensionVersionCatalog(
    manager: "npm" | "pnpm",
    runtimeRoot: string,
    onebotsVersion: string,
): ExtensionVersionCatalogSnapshot {
    const installedVersion = resolveInstalledPackageVersion("onebots", runtimeRoot);
    return loadVersionCatalog(
        manager,
        runtimeRoot,
        onebotsVersion,
        installedVersion,
        process.argv[1],
    );
}

function latestVersion(manager: "npm" | "pnpm", name: string): string | null {
    const invocation = buildPackageManagerInvocation(manager, ["view", name, "version"]);
    try {
        return execFileSync(invocation.executable, invocation.args, {
            encoding: "utf8",
            env: invocation.environment,
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();
    } catch {
        return null;
    }
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
            try {
                const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
                    name?: unknown;
                    dependencies?: Record<string, string>;
                    devDependencies?: Record<string, string>;
                    optionalDependencies?: Record<string, string>;
                };
                if (
                    parsed.name === "onebots" ||
                    parsed.dependencies?.onebots ||
                    parsed.devDependencies?.onebots ||
                    parsed.optionalDependencies?.onebots
                ) {
                    const inspection = inspectExtensionRuntimeRoot(current);
                    if (inspection.error) {
                        throw new Error(`项目更新目录无法验证：${inspection.error}`);
                    }
                    return current;
                }
            } catch (error) {
                if (error instanceof Error && error.message.startsWith("项目更新目录无法验证：")) {
                    throw error;
                }
                invalidManifest ??= manifest;
                // 子目录清单损坏时仍允许上层经验证的 OneBots 项目成为目标。
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
