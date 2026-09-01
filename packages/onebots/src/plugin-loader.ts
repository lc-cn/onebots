import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    AdapterRegistry,
    ProtocolRegistry,
    captureExtensionRegistryState,
    restoreExtensionRegistryState,
    runWithExtensionRegistrationScope,
    type ExtensionRegistryState,
} from "@onebots/core";
import { writeCliError } from "./cli-output.js";
import { parseProtocolPluginIdentity } from "./protocol-plugin-identity.js";

export type PluginInspection =
    | {
          status: "ready";
          candidate: string;
          entryPath: string;
          packageName: string;
          version: string | null;
      }
    | { status: "broken"; candidate: string; reason: string; buildCommand?: string }
    | { status: "missing"; candidates: string[] };

export type PluginLoadResult =
    | { loaded: true; inspection: Extract<PluginInspection, { status: "ready" }> }
    | { loaded: false; inspection: PluginInspection; message: string };

export type PluginType = "adapter" | "protocol";

export interface LoadedPluginInfo {
    type: PluginType;
    name: string;
    packageName: string;
    version: string | null;
    entryPath: string;
}

type ReadyPluginInspection = Extract<PluginInspection, { status: "ready" }>;
type PluginInspectionGuard = (inspection: ReadyPluginInspection) => string | undefined;

let pluginRegistrationTail = Promise.resolve();
const loadedPlugins = new Map<string, LoadedPluginInfo>();
const rejectedPluginImportAttempts = new Map<string, number>();

/** 返回当前进程已通过注册契约校验的扩展，顺序不受 CLI 参数顺序影响。 */
export function getLoadedPlugins(): LoadedPluginInfo[] {
    return [...loadedPlugins.values()]
        .map(plugin => ({ ...plugin }))
        .sort((left, right) => {
            const leftKey = `${left.type}:${left.name}`;
            const rightKey = `${right.type}:${right.name}`;
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        });
}

/** @internal 仅供隔离测试进程级插件状态。 */
export function clearLoadedPlugins(): void {
    loadedPlugins.clear();
    rejectedPluginImportAttempts.clear();
}

/** 所有 CLI 路径共享同一组插件包名候选，避免运行、doctor 与服务预检规则漂移。 */
export function pluginCandidates(type: PluginType, name: string): string[] {
    const prefix = type === "adapter" ? "adapter" : "protocol";
    return [`@onebots/${prefix}-${name}`, `onebots-${prefix}-${name}`, name];
}

/** 区分插件未安装与 workspace 包存在但构建入口缺失。 */
export function inspectPlugin(
    candidates: string[],
    runtimeRequire: NodeJS.Require,
): PluginInspection {
    for (const candidate of candidates) {
        let requireEntry: string | undefined;
        try {
            requireEntry = runtimeRequire.resolve(candidate);
        } catch {
            // 纯 ESM 包可能只暴露 exports.import，继续从 package.json 解析。
        }

        const packageJsonPath = resolvePackageJson(candidate, runtimeRequire, requireEntry);
        if (packageJsonPath) {
            const manifest = readPackageJson(packageJsonPath);
            const expectedPackageName = parsePackageName(candidate);
            if (expectedPackageName && manifest.name !== expectedPackageName) {
                const actualPackageName =
                    typeof manifest.name === "string" && manifest.name.trim()
                        ? manifest.name.trim()
                        : "未声明";
                return {
                    status: "broken",
                    candidate,
                    reason: `package.json 包名错配，期望 ${expectedPackageName}，实际 ${actualPackageName}`,
                };
            }
            const entryPath = resolvePackageEntry(candidate, packageJsonPath);
            if (!entryPath) {
                return {
                    status: "broken",
                    candidate,
                    reason: "package.json 未提供可导入的插件入口",
                    buildCommand: candidate.startsWith("@onebots/")
                        ? `pnpm --filter ${candidate} build`
                        : undefined,
                };
            }
            if (fs.existsSync(entryPath)) {
                const boundaryError = inspectPackageEntryBoundary(packageJsonPath, entryPath);
                if (boundaryError) {
                    return {
                        status: "broken",
                        candidate,
                        reason: boundaryError,
                    };
                }
                return readyInspection(candidate, entryPath, manifest);
            }
            return {
                status: "broken",
                candidate,
                reason: `构建产物不存在: ${entryPath}`,
                buildCommand: candidate.startsWith("@onebots/")
                    ? `pnpm --filter ${candidate} build`
                    : undefined,
            };
        }

        if (requireEntry) return readyInspection(candidate, requireEntry);
    }
    return { status: "missing", candidates };
}

/** 加载第一个可用插件，并且每个逻辑插件最多输出一条诊断。 */
export async function tryLoadPlugin(
    kind: "适配器" | "协议",
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
): Promise<PluginLoadResult> {
    return serializePluginRegistration(() =>
        tryLoadPluginUnlocked(kind, name, candidates, runtimeRequire),
    );
}

async function tryLoadPluginUnlocked(
    kind: "适配器" | "协议",
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
    inspectionGuard?: PluginInspectionGuard,
): Promise<PluginLoadResult> {
    const inspection = inspectPlugin(candidates, runtimeRequire);
    if (inspection.status === "missing") {
        return {
            loaded: false,
            inspection,
            message: `未找到${kind} ${name}（已尝试: ${inspection.candidates.join(", ")}）`,
        };
    }
    if (inspection.status === "broken") {
        const suggestion = inspection.buildCommand ? `；请先运行 ${inspection.buildCommand}` : "";
        return {
            loaded: false,
            inspection,
            message: `加载${kind} ${name} 失败：已找到 ${inspection.candidate}，但入口无法加载（${inspection.reason}）${suggestion}`,
        };
    }
    const runtimeMismatch = findExtensionRuntimeMismatch(inspection.entryPath);
    if (runtimeMismatch) {
        return {
            loaded: false,
            inspection,
            message: `加载${kind} ${name} 失败：${inspection.candidate} 解析到了独立的 ${runtimeMismatch.packageName} 运行时（插件: ${runtimeMismatch.pluginPackageJson}；网关: ${runtimeMismatch.hostPackageJson}）；请将 ${runtimeMismatch.packageName} 声明为 peerDependency，由同一安装根目录提供，并删除插件内的重复副本`,
        };
    }
    const inspectionError = inspectionGuard?.(inspection);
    if (inspectionError) {
        return {
            loaded: false,
            inspection,
            message: `加载${kind} ${name} 失败：${inspectionError}`,
        };
    }
    const registryState = captureExtensionRegistryState();
    try {
        await runWithExtensionRegistrationScope(
            () => import(pluginImportUrl(inspection.entryPath)),
        );
        return { loaded: true, inspection };
    } catch (error) {
        restoreExtensionRegistryState(registryState);
        markPluginImportRejected(inspection.entryPath);
        return {
            loaded: false,
            inspection,
            message: `加载${kind} ${name} 失败：${inspection.candidate} 运行时初始化失败（${firstLine(error)}）`,
        };
    }
}

/** 加载插件后确认它提供了 CLI 名称所承诺的工厂与配置 Schema。 */
export async function tryLoadRegisteredPlugin(
    type: PluginType,
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
): Promise<PluginLoadResult> {
    return serializePluginRegistration(async () => {
        const registryState = captureExtensionRegistryState();
        const kind = type === "adapter" ? "适配器" : "协议";
        const result = await tryLoadPluginUnlocked(
            kind,
            name,
            candidates,
            runtimeRequire,
            inspection => getLoadedPluginIdentityError(type, name, inspection),
        );
        if (result.loaded === false) {
            restoreExtensionRegistryState(registryState);
            return result;
        }

        const contractError = getRegistrationContractError(
            type,
            name,
            registryState,
            captureExtensionRegistryState(),
            result.inspection,
        );
        if (!contractError) {
            loadedPlugins.set(`${type}:${name}`, {
                type,
                name,
                packageName: result.inspection.packageName,
                version: result.inspection.version,
                entryPath: realPath(result.inspection.entryPath),
            });
            return result;
        }
        restoreExtensionRegistryState(registryState);
        markPluginImportRejected(result.inspection.entryPath);
        return {
            loaded: false,
            inspection: result.inspection,
            message: `加载${kind} ${name} 失败：${result.inspection.candidate} 已初始化，但${contractError}`,
        };
    });
}

function getLoadedPluginIdentityError(
    type: PluginType,
    name: string,
    inspection: ReadyPluginInspection,
): string | undefined {
    const loadedKey = `${type}:${name}`;
    const previous = loadedPlugins.get(loadedKey);
    if (!previous) return undefined;
    const entryPath = realPath(inspection.entryPath);
    if (
        previous.packageName === inspection.packageName &&
        previous.version === inspection.version &&
        previous.entryPath === entryPath
    ) {
        return undefined;
    }
    return `扩展身份 ${loadedKey} 已由 ${formatPluginIdentity(previous.packageName, previous.version, previous.entryPath)} 加载；当前解析为 ${formatPluginIdentity(inspection.packageName, inspection.version, entryPath)}，拒绝在同一进程执行不同的插件入口或版本；请重启 OneBots 后加载新版本`;
}

function formatPluginIdentity(
    packageName: string,
    version: string | null,
    entryPath: string,
): string {
    return `${packageName}@${version ?? "unknown"}（${entryPath}）`;
}

/**
 * Node 会缓存已经成功求值的 ESM。若宿主随后因注册契约拒绝该事务，下一次加载必须使用
 * 新的模块标识才能重新执行入口；通过验收后则继续复用同一标识，保留重复加载的幂等性。
 */
function pluginImportUrl(entryPath: string): string {
    const resolvedEntry = realPath(entryPath);
    const attempt = rejectedPluginImportAttempts.get(resolvedEntry) ?? 0;
    const url = pathToFileURL(entryPath);
    if (attempt > 0) url.searchParams.set("onebots_retry", String(attempt));
    return url.href;
}

function markPluginImportRejected(entryPath: string): void {
    const resolvedEntry = realPath(entryPath);
    const attempt = rejectedPluginImportAttempts.get(resolvedEntry) ?? 0;
    rejectedPluginImportAttempts.set(resolvedEntry, attempt + 1);
}

/** 注册表是进程级共享状态；串行化导入，避免一个失败事务回滚另一个并发插件。 */
async function serializePluginRegistration<T>(operation: () => Promise<T>): Promise<T> {
    const previous = pluginRegistrationTail;
    let release: () => void = () => undefined;
    pluginRegistrationTail = new Promise<void>(resolve => {
        release = resolve;
    });
    await previous;
    try {
        return await operation();
    } finally {
        release();
    }
}

/** 兼容布尔返回值的加载入口；失败时输出结构化结果中的唯一诊断。 */
export async function loadPlugin(
    type: PluginType,
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
    warn: (message: string) => void = writeCliError,
): Promise<boolean> {
    const result = await tryLoadRegisteredPlugin(type, name, candidates, runtimeRequire);
    if (result.loaded === false) {
        warn(`[onebots] ${result.message}`);
    }
    return result.loaded;
}

function getRegistrationContractError(
    type: PluginType,
    name: string,
    before: ExtensionRegistryState,
    after: ExtensionRegistryState,
    inspection: Extract<PluginInspection, { status: "ready" }>,
): string | undefined {
    const loadedKey = `${type}:${name}`;
    const previousPlugin = loadedPlugins.get(loadedKey);
    if (previousPlugin) {
        if (
            previousPlugin.packageName !== inspection.packageName ||
            previousPlugin.version !== inspection.version ||
            previousPlugin.entryPath !== realPath(inspection.entryPath)
        ) {
            return `扩展身份 ${loadedKey} 已由 ${formatPluginIdentity(previousPlugin.packageName, previousPlugin.version, previousPlugin.entryPath)} 加载`;
        }
    } else if (hasPromisedRegistration(type, name, before)) {
        return `承诺的扩展身份 ${loadedKey} 在本次插件加载前已经存在，无法证明注册归属`;
    }

    if (type === "adapter") {
        if (!AdapterRegistry.has(name)) return `没有注册适配器 ${name}`;
        if (!AdapterRegistry.getSchema(name)) return `没有注册适配器配置 Schema ${name}`;
    } else {
        const identity = parseProtocolPluginIdentity(name);
        if (!identity) return `协议插件名必须使用 <name>-<version> 格式（例如 onebot-v11）`;
        const { protocol, version, schemaKey } = identity;
        if (!ProtocolRegistry.has(protocol, version)) {
            return `没有注册协议 ${protocol}/${version}`;
        }
        if (!ProtocolRegistry.getSchema(schemaKey)) {
            return `没有注册协议配置 Schema ${schemaKey}`;
        }
    }

    const allowed = promisedRegistryChangeKeys(type, name);
    const unexpected = getRegistryChanges(before, after).filter(change => !allowed.has(change.key));
    if (unexpected.length) {
        return `修改了 CLI 名称未承诺的注册项：${unexpected.map(change => change.description).join("、")}；单个插件只能修改自身工厂、元数据与配置 Schema`;
    }
    return undefined;
}

function hasPromisedRegistration(
    type: PluginType,
    name: string,
    state: ExtensionRegistryState,
): boolean {
    if (type === "adapter") {
        return (
            state.adapters.factories.has(name) ||
            state.adapters.metadata.has(name) ||
            state.adapters.schemas.has(name)
        );
    }
    const identity = parseProtocolPluginIdentity(name);
    if (!identity) return false;
    const { protocol, version, schemaKey } = identity;
    return (
        state.protocols.factories.get(protocol)?.has(version) === true ||
        state.protocols.schemas.has(schemaKey)
    );
}

interface RegistryChange {
    key: string;
    description: string;
}

function promisedRegistryChangeKeys(type: PluginType, name: string): Set<string> {
    if (type === "adapter") {
        return new Set([
            `adapter.factory:${name}`,
            `adapter.metadata:${name}`,
            `adapter.schema:${name}`,
        ]);
    }
    const identity = parseProtocolPluginIdentity(name);
    if (!identity) return new Set();
    return new Set([
        `protocol.factory:${identity.protocol}/${identity.version}`,
        `protocol.metadata:${identity.protocol}`,
        `protocol.schema:${identity.schemaKey}`,
    ]);
}

function getRegistryChanges(
    before: ExtensionRegistryState,
    after: ExtensionRegistryState,
): RegistryChange[] {
    const changes: RegistryChange[] = [];
    appendMapChanges(
        changes,
        "adapter.factory",
        "适配器工厂",
        before.adapters.factories,
        after.adapters.factories,
    );
    appendMapChanges(
        changes,
        "adapter.metadata",
        "适配器元数据",
        before.adapters.metadata,
        after.adapters.metadata,
        jsonEqual,
    );
    appendMapChanges(
        changes,
        "adapter.schema",
        "适配器 Schema",
        before.adapters.schemas,
        after.adapters.schemas,
    );
    appendMapChanges(
        changes,
        "protocol.factory",
        "协议工厂",
        flattenProtocolFactories(before.protocols.factories),
        flattenProtocolFactories(after.protocols.factories),
    );
    appendMapChanges(
        changes,
        "protocol.metadata",
        "协议元数据",
        before.protocols.metadata,
        after.protocols.metadata,
        jsonEqual,
    );
    appendMapChanges(
        changes,
        "protocol.schema",
        "协议 Schema",
        before.protocols.schemas,
        after.protocols.schemas,
    );
    return changes.sort((left, right) => left.key.localeCompare(right.key));
}

function appendMapChanges<T>(
    target: RegistryChange[],
    prefix: string,
    label: string,
    before: ReadonlyMap<string, T>,
    after: ReadonlyMap<string, T>,
    equal: (left: T | undefined, right: T | undefined) => boolean = Object.is,
): void {
    const keys = new Set([...before.keys(), ...after.keys()]);
    for (const key of keys) {
        if (before.has(key) === after.has(key) && equal(before.get(key), after.get(key))) continue;
        target.push({ key: `${prefix}:${key}`, description: `${label} ${key}` });
    }
}

function flattenProtocolFactories(
    factories: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
): Map<string, unknown> {
    return new Map(
        [...factories].flatMap(([name, versions]) =>
            [...versions].map(([version, factory]) => [`${name}/${version}`, factory] as const),
        ),
    );
}

function jsonEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

interface PackageManifest {
    name?: unknown;
    version?: unknown;
    main?: unknown;
    module?: unknown;
    exports?: unknown;
}

function readyInspection(
    candidate: string,
    entryPath: string,
    manifest?: PackageManifest,
): Extract<PluginInspection, { status: "ready" }> {
    return {
        status: "ready",
        candidate,
        entryPath,
        packageName:
            typeof manifest?.name === "string" && manifest.name.trim()
                ? manifest.name.trim()
                : (parsePackageName(candidate) ?? candidate),
        version:
            typeof manifest?.version === "string" && manifest.version.trim()
                ? manifest.version.trim()
                : null,
    };
}

interface ExtensionRuntimeMismatch {
    packageName: "onebots" | "@onebots/core";
    pluginPackageJson: string;
    hostPackageJson: string;
}

/** 阻止插件绑定到另一套静态 Registry；这类插件即使完成初始化也不会注册到当前网关。 */
function findExtensionRuntimeMismatch(entryPath: string): ExtensionRuntimeMismatch | undefined {
    const pluginRequire = createRequire(entryPath);
    const hostRequire = createRequire(import.meta.url);
    const hostPackages: ReadonlyArray<readonly [ExtensionRuntimeMismatch["packageName"], string?]> =
        [
            ["onebots", fileURLToPath(new URL("../package.json", import.meta.url))],
            ["@onebots/core", resolvePackageJson("@onebots/core", hostRequire)],
        ];

    for (const [packageName, hostPackageJson] of hostPackages) {
        if (!hostPackageJson) continue;
        const pluginPackageJson = resolvePackageJson(packageName, pluginRequire);
        if (!pluginPackageJson) continue;
        if (realPath(pluginPackageJson) !== realPath(hostPackageJson)) {
            return {
                packageName,
                pluginPackageJson,
                hostPackageJson,
            };
        }
    }
    return undefined;
}

function realPath(file: string): string {
    try {
        return fs.realpathSync(file);
    } catch {
        return path.resolve(file);
    }
}

function resolvePackageJson(
    candidate: string,
    runtimeRequire: NodeJS.Require,
    requireEntry?: string,
): string | undefined {
    const packageName = parsePackageName(candidate);
    if (!packageName) return undefined;

    for (const searchPath of runtimeRequire.resolve.paths(packageName) ?? []) {
        const packageJsonPath = path.join(searchPath, packageName, "package.json");
        if (fs.existsSync(packageJsonPath)) return packageJsonPath;
    }

    if (requireEntry) {
        let directory = path.dirname(requireEntry);
        while (directory !== path.dirname(directory)) {
            const packageJsonPath = path.join(directory, "package.json");
            if (fs.existsSync(packageJsonPath)) {
                const manifest = readPackageJson(packageJsonPath);
                if (manifest.name === packageName) return packageJsonPath;
            }
            directory = path.dirname(directory);
        }
    }
    return undefined;
}

function readPackageJson(file: string): PackageManifest {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as PackageManifest;
    } catch {
        return {};
    }
}

/** 允许整个包目录由 workspace/pnpm 软链接提供，但包内 manifest 与入口必须留在实际包根。 */
function inspectPackageEntryBoundary(
    packageJsonPath: string,
    entryPath: string,
): string | undefined {
    try {
        const packageRoot = fs.realpathSync(path.dirname(packageJsonPath));
        const manifestPath = fs.realpathSync(packageJsonPath);
        if (path.dirname(manifestPath) !== packageRoot) {
            return `package.json 解析到实际包目录外: ${manifestPath}`;
        }
        const resolvedEntry = fs.realpathSync(entryPath);
        const relative = path.relative(packageRoot, resolvedEntry);
        if (
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
        ) {
            return `插件入口解析到实际包目录外: ${resolvedEntry}`;
        }
        return undefined;
    } catch (error) {
        return `无法确认插件入口的实际归属: ${error instanceof Error ? error.message : String(error)}`;
    }
}

function resolvePackageEntry(candidate: string, packageJsonPath: string): string | undefined {
    const manifest = readPackageJson(packageJsonPath);
    const packageName = parsePackageName(candidate);
    if (!packageName) return undefined;
    const subpath = candidate === packageName ? "." : `.${candidate.slice(packageName.length)}`;
    const exported = resolveExportTarget(manifest.exports, subpath);
    const usesExports = manifest.exports !== undefined;
    const target =
        exported ??
        (!usesExports && typeof manifest.module === "string" ? manifest.module : undefined) ??
        (!usesExports && typeof manifest.main === "string" ? manifest.main : undefined) ??
        (!usesExports ? "index.js" : undefined);
    if (!target || (usesExports && !target.startsWith("./")) || path.isAbsolute(target)) {
        return undefined;
    }

    const packageDirectory = path.dirname(packageJsonPath);
    const entryPath = path.resolve(packageDirectory, target);
    const relative = path.relative(packageDirectory, entryPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return undefined;
    }
    return entryPath;
}

function resolveExportTarget(exportsValue: unknown, subpath: string): string | undefined {
    if (typeof exportsValue === "string") return subpath === "." ? exportsValue : undefined;
    if (Array.isArray(exportsValue)) {
        for (const option of exportsValue) {
            const target = resolveExportTarget(option, subpath);
            if (target) return target;
        }
        return undefined;
    }
    if (!exportsValue || typeof exportsValue !== "object") return undefined;

    const exportsMap = exportsValue as Record<string, unknown>;
    const hasSubpaths = Object.keys(exportsMap).some(key => key.startsWith("."));
    if (hasSubpaths) return resolveExportTarget(exportsMap[subpath], ".");
    if (subpath !== ".") return undefined;
    for (const condition of ["import", "node", "default", "require"] as const) {
        const target = resolveExportTarget(exportsMap[condition], ".");
        if (target) return target;
    }
    return undefined;
}

function parsePackageName(candidate: string): string | undefined {
    if (candidate.startsWith(".") || candidate.startsWith("/") || candidate.startsWith("file:")) {
        return undefined;
    }
    const parts = candidate.split("/");
    if (candidate.startsWith("@")) {
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
    }
    return parts[0] || undefined;
}

function firstLine(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}
