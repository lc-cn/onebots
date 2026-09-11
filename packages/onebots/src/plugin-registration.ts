import { pathToFileURL } from "node:url";
import {
    AdapterRegistry,
    ApplicationRegistry,
    ProtocolRegistry,
    captureExtensionRegistryState,
    restoreExtensionRegistryState,
    runWithExtensionRegistrationScope,
    type ExtensionRegistryState,
} from "@onebots/core";
import { writeCliError } from "./cli-output.js";
import { findExtensionRuntimeMismatch, inspectPlugin, realPath } from "./plugin-inspection.js";
import {
    PLUGIN_LOAD_TIMEOUT_MS,
    type LoadedPluginInfo,
    type PluginInspection,
    type PluginLoadOptions,
    type PluginLoadResult,
    type PluginType,
    type ReadyPluginInspection,
} from "./plugin-loader-types.js";
import { parseProtocolPluginIdentity } from "./protocol-plugin-identity.js";

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

/** 加载第一个可用插件，并且每个逻辑插件最多输出一条诊断。 */
export async function tryLoadPlugin(
    kind: string,
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
    options: PluginLoadOptions = {},
): Promise<PluginLoadResult> {
    return serializePluginRegistration(() =>
        tryLoadPluginUnlocked(kind, name, candidates, runtimeRequire, undefined, options),
    );
}

async function tryLoadPluginUnlocked(
    kind: string,
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
    inspectionGuard?: PluginInspectionGuard,
    options: PluginLoadOptions = {},
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
            { timeoutMs: options.timeoutMs ?? PLUGIN_LOAD_TIMEOUT_MS },
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
    options: PluginLoadOptions = {},
): Promise<PluginLoadResult> {
    return serializePluginRegistration(async () => {
        const registryState = captureExtensionRegistryState();
        const kind = type === "adapter" ? "适配器" : type === "protocol" ? "协议" : "应用";
        const result = await tryLoadPluginUnlocked(
            kind,
            name,
            candidates,
            runtimeRequire,
            inspection => getLoadedPluginIdentityError(type, name, inspection),
            options,
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
                moduleUrl: pluginImportUrl(result.inspection.entryPath),
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
    options: PluginLoadOptions = {},
): Promise<boolean> {
    const result = await tryLoadRegisteredPlugin(type, name, candidates, runtimeRequire, options);
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

    if (type === "application") {
        if (!ApplicationRegistry.has(name)) return `没有注册应用 ${name}`;
    } else if (type === "adapter") {
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
    if (type === "application") return state.applications.definitions.has(name);
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
    if (type === "application") return new Set([`application.definition:${name}`]);
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
        "application.definition",
        "应用定义",
        before.applications.definitions,
        after.applications.definitions,
    );
    appendMapChanges(
        changes,
        "application.active",
        "应用激活状态",
        new Map(before.applications.active.map(name => [name, true])),
        new Map(after.applications.active.map(name => [name, true])),
    );
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

function firstLine(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}
