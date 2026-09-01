import { Protocol } from "./protocol.js";
import { Adapter } from "./adapter.js";
import { BaseApp } from "./base-app.js";
import { Account } from "./account.js";
import { assertSchemaFormContract, type Schema } from "./config-validator.js";
import { ValidationError } from "./errors.js";
import {
    assertSupportedActionsImplemented,
    normalizeAdapterCapabilities,
} from "./adapter-capability.js";
import { isDeepStrictEqual } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import {
    assertAdapterFactoryContract,
    assertProtocolFactoryContract,
} from "./extension-factory-contract.js";
import { invokeExtensionFactoryWithRegistryBoundary } from "./extension-factory-registry-boundary.js";

interface ExtensionRegistrationScope {
    open: boolean;
}

export interface ExtensionRegistrationScopeOptions {
    timeoutMs?: number;
}

const extensionRegistrationScope = new AsyncLocalStorage<ExtensionRegistrationScope>();
const MAX_REGISTRATION_TIMEOUT_MS = 2_147_483_647;

/**
 * 将一次插件导入标记为唯一可写的注册时段。
 *
 * 插件在导入期间创建的定时器和 Promise 会继承同一上下文；导入完成后关闭共享标记，
 * 这些异步后代再尝试修改注册表时会被拒绝，避免迟到注册逃出宿主的验收与回滚边界。
 */
export async function runWithExtensionRegistrationScope<T>(
    operation: () => Promise<T>,
    options: ExtensionRegistrationScopeOptions = {},
): Promise<T> {
    if (
        options.timeoutMs !== undefined &&
        (!Number.isSafeInteger(options.timeoutMs) ||
            options.timeoutMs <= 0 ||
            options.timeoutMs > MAX_REGISTRATION_TIMEOUT_MS)
    ) {
        throw new ValidationError(
            `插件注册事务超时必须是 1 到 ${MAX_REGISTRATION_TIMEOUT_MS} 之间的整数毫秒`,
        );
    }
    const scope: ExtensionRegistrationScope = { open: true };
    let timeout: NodeJS.Timeout | undefined;
    try {
        const execution = extensionRegistrationScope.run(scope, operation);
        if (options.timeoutMs === undefined) return await execution;
        const deadline = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
                () =>
                    reject(new ValidationError(`插件注册事务超过 ${options.timeoutMs} 毫秒未完成`)),
                options.timeoutMs,
            );
        });
        return await Promise.race([execution, deadline]);
    } finally {
        if (timeout) clearTimeout(timeout);
        scope.open = false;
    }
}

function assertExtensionRegistryMutationOpen(): void {
    const scope = extensionRegistrationScope.getStore();
    if (scope && !scope.open) {
        throw new ValidationError("插件注册事务已结束，拒绝迟到的注册表修改");
    }
}

export interface ExtensionRegistryState {
    readonly adapters: {
        readonly factories: ReadonlyMap<string, Adapter.Factory>;
        readonly metadata: ReadonlyMap<string, Adapter.Metadata>;
        readonly schemas: ReadonlyMap<string, Schema>;
    };
    readonly protocols: {
        readonly factories: ReadonlyMap<string, ReadonlyMap<string, Protocol.Factory>>;
        readonly metadata: ReadonlyMap<string, Protocol.Metadata>;
        readonly schemas: ReadonlyMap<string, Schema>;
    };
}

/**
 * Protocol Registry
 * Manages registration and retrieval of protocol implementations
 */
export class ProtocolRegistry {
    private static protocols: Map<string, Map<string, Protocol.Factory>> = new Map();
    private static metadata: Map<string, Protocol.Metadata> = new Map();
    private static schemas: Map<string, Schema> = new Map();
    private static schemaSnapshots = new WeakMap<Schema, Schema>();

    /**
     * Register a protocol implementation
     * @param name Protocol name (e.g., 'onebot', 'milky', 'satori')
     * @param version Protocol version (e.g., 'v11', 'v12')
     * @param factory Protocol factory function
     * @param metadata Optional protocol metadata
     */
    static register(
        name: string,
        version: string,
        factory: Protocol.Factory,
        metadata?: Partial<Protocol.Metadata>,
    ): void {
        assertExtensionRegistryMutationOpen();
        if (!this.protocols.has(name)) {
            this.protocols.set(name, new Map());
        }

        const versions = this.protocols.get(name)!;
        const registeredFactory = versions.get(version);
        if (registeredFactory) {
            if (registeredFactory === factory) {
                return;
            }
            throw new ValidationError(`协议 ${name}/${version} 已由其他实现注册`, {
                context: { name, version },
            });
        }
        versions.set(version, factory);
        // Store or update metadata
        if (!this.metadata.has(name)) {
            this.metadata.set(
                name,
                freezeProtocolMetadata({
                    name,
                    displayName: metadata?.displayName || name,
                    description: metadata?.description || "",
                    versions: [version],
                }),
            );
        } else {
            const meta = this.metadata.get(name)!;
            if (!meta.versions.includes(version)) {
                this.metadata.set(
                    name,
                    freezeProtocolMetadata({ ...meta, versions: [...meta.versions, version] }),
                );
            }
        }
    }

    /**
     * Register a protocol config schema (key format: name.version)
     */
    static registerSchema(key: string, schema: Schema): void {
        assertExtensionRegistryMutationOpen();
        assertSchemaFormContract(schema);
        const registeredSchema = this.schemas.get(key);
        if (registeredSchema) {
            if (this.schemaSnapshots.get(schema) === registeredSchema) {
                return;
            }
            throw new ValidationError(`协议配置 Schema ${key} 已由其他实现注册`, {
                context: { key },
            });
        }
        const snapshot = this.schemaSnapshots.get(schema) ?? createImmutableSchemaSnapshot(schema);
        this.schemaSnapshots.set(schema, snapshot);
        this.schemas.set(key, snapshot);
    }

    /**
     * Get a protocol config schema by key
     */
    static getSchema(key: string): Schema | undefined {
        return this.schemas.get(key);
    }

    /**
     * Get all protocol config schemas
     */
    static getAllSchemas(): Record<string, Schema> {
        return Object.fromEntries(this.schemas.entries());
    }

    /**
     * Get a protocol factory
     * @param name Protocol name
     * @param version Protocol version
     */
    static get(name: string, version: string): Protocol.Factory | undefined {
        return this.protocols.get(name)?.get(version);
    }

    /**
     * Check if a protocol version is registered
     */
    static has(name: string, version?: string): boolean {
        if (!version) {
            return this.protocols.has(name);
        }
        return this.protocols.get(name)?.has(version) || false;
    }

    /**
     * Get all registered protocol names
     */
    static getProtocolNames(): string[] {
        return Array.from(this.protocols.keys());
    }

    /**
     * Get all versions for a protocol
     */
    static getVersions(name: string): string[] {
        const versions = this.protocols.get(name);
        return versions ? Array.from(versions.keys()) : [];
    }

    /**
     * Get protocol metadata
     */
    static getMetadata(name: string): Protocol.Metadata | undefined {
        return this.metadata.get(name);
    }

    /**
     * Get all protocol metadata
     */
    static getAllMetadata(): Protocol.Metadata[] {
        return Array.from(this.metadata.values());
    }

    /**
     * Create a protocol instance
     */
    static create(
        name: string,
        version: string,
        adapter: Adapter,
        account: Account,
        config: Record<string, unknown>,
    ): Protocol {
        const factory = this.get(name, version);
        if (!factory) {
            throw new Error(`Protocol ${name}/${version} not registered`);
        }
        const protocol = invokeExtensionFactoryWithRegistryBoundary(
            `协议 ${name}/${version}`,
            () =>
                Protocol.isClassFactory(factory)
                    ? new factory(adapter, account, config)
                    : factory(adapter, account, config),
            extensionRegistryBoundary,
        );
        assertProtocolFactoryContract(protocol, name, version, adapter, account);
        return protocol;
    }

    /** 验证第三方账号没有绕过注册表注入、遗漏或替换协议实例。 */
    static assertAccountProtocols(
        account: Account,
        adapter: Adapter,
        config: Account.Config,
    ): void {
        const label = `账号 ${config.platform}/${config.account_id}`;
        const expected = Object.keys(config)
            .map(key => key.split("."))
            .filter(
                (identity): identity is [string, string, ...string[]] =>
                    Boolean(identity[0] && identity[1]) && this.has(identity[0]!, identity[1]!),
            )
            .map(([name, version]) => `${name}.${version}`)
            .sort();
        const actual = account.protocols.map(protocol => {
            const name = typeof protocol?.name === "string" ? protocol.name.trim() : "";
            const version = typeof protocol?.version === "string" ? protocol.version.trim() : "";
            if (!name || !version) {
                throw new ValidationError(`${label} 工厂返回了缺少有效身份的协议实例`, {
                    context: { platform: config.platform, account_id: config.account_id },
                });
            }
            if (!this.has(name, version)) {
                throw new ValidationError(`${label} 工厂注入了未注册协议 ${name}/${version}`, {
                    context: {
                        platform: config.platform,
                        account_id: config.account_id,
                        name,
                        version,
                    },
                });
            }
            assertProtocolFactoryContract(protocol, name, version, adapter, account);
            return `${name}.${version}`;
        });
        actual.sort();
        if (!isDeepStrictEqual(actual, expected)) {
            throw new ValidationError(`${label} 工厂返回的协议集合与账号配置不一致`, {
                context: {
                    platform: config.platform,
                    account_id: config.account_id,
                    expected,
                    actual,
                },
            });
        }
    }

    /**
     * Unregister a protocol version
     */
    static unregister(name: string, version?: string): boolean {
        assertExtensionRegistryMutationOpen();
        if (!version) {
            // Unregister all versions
            this.protocols.delete(name);
            this.metadata.delete(name);
            for (const key of this.schemas.keys()) {
                if (key.startsWith(`${name}.`)) {
                    this.schemas.delete(key);
                }
            }
            return true;
        }

        const versions = this.protocols.get(name);
        if (!versions) return false;

        const result = versions.delete(version);
        this.schemas.delete(`${name}.${version}`);

        // Update metadata
        const meta = this.metadata.get(name);
        if (meta) {
            const remainingVersions = meta.versions.filter(v => v !== version);
            if (remainingVersions.length === 0) {
                this.metadata.delete(name);
                this.protocols.delete(name);
            } else {
                this.metadata.set(
                    name,
                    freezeProtocolMetadata({ ...meta, versions: remainingVersions }),
                );
            }
        }

        return result;
    }

    /**
     * Clear all registered protocols
     */
    static clear(): void {
        assertExtensionRegistryMutationOpen();
        this.protocols.clear();
        this.metadata.clear();
        this.schemas.clear();
    }

    /** @internal 供插件加载事务捕获当前注册状态。 */
    static captureState(): ExtensionRegistryState["protocols"] {
        return {
            factories: new Map(
                [...this.protocols].map(([name, versions]) => [name, new Map(versions)]),
            ),
            metadata: new Map(this.metadata),
            schemas: new Map(this.schemas),
        };
    }

    /** @internal 恢复插件加载前的精确注册状态。 */
    static restoreState(state: ExtensionRegistryState["protocols"]): void {
        assertExtensionRegistryMutationOpen();
        this.protocols = new Map(
            [...state.factories].map(([name, versions]) => [name, new Map(versions)]),
        );
        this.metadata = new Map(
            [...state.metadata].map(([name, metadata]) => [name, freezeProtocolMetadata(metadata)]),
        );
        this.schemas = new Map(state.schemas);
    }
}
/**
 * Adapter Registry
 * Manages registration and retrieval of adapter implementations
 */
export class AdapterRegistry {
    private static adapters: Map<string, Adapter.Factory> = new Map();
    private static metadata: Map<string, Adapter.Metadata> = new Map();
    private static schemas: Map<string, Schema> = new Map();
    private static schemaSnapshots = new WeakMap<Schema, Schema>();

    /**
     * Register an adapter implementation
     * @param name Adapter name/platform (e.g., 'wechat', 'dingtalk', 'qq')
     * @param factory Adapter factory/class
     * @param metadata Optional adapter metadata
     */
    static register(
        name: string,
        factory: Adapter.Factory,
        metadata?: Partial<Adapter.Metadata>,
    ): void {
        assertExtensionRegistryMutationOpen();
        const registeredFactory = this.adapters.get(name);
        if (registeredFactory) {
            if (registeredFactory === factory) {
                return;
            }
            throw new ValidationError(`适配器 ${name} 已由其他实现注册`, {
                context: { name },
            });
        }
        const capabilities = metadata?.capabilities
            ? normalizeAdapterCapabilities(metadata.capabilities)
            : undefined;
        this.adapters.set(name, factory);
        // Store or update metadata
        if (!this.metadata.has(name)) {
            this.metadata.set(
                name,
                freezeAdapterMetadata({
                    name,
                    displayName: metadata?.displayName || name,
                    description: metadata?.description || "",
                    icon: metadata?.icon || "",
                    homepage: metadata?.homepage,
                    author: metadata?.author,
                    capabilities,
                }),
            );
        }
    }

    /**
     * Register an adapter config schema
     */
    static registerSchema(name: string, schema: Schema): void {
        assertExtensionRegistryMutationOpen();
        assertSchemaFormContract(schema);
        const registeredSchema = this.schemas.get(name);
        if (registeredSchema) {
            if (this.schemaSnapshots.get(schema) === registeredSchema) {
                return;
            }
            throw new ValidationError(`适配器配置 Schema ${name} 已由其他实现注册`, {
                context: { name },
            });
        }
        const snapshot = this.schemaSnapshots.get(schema) ?? createImmutableSchemaSnapshot(schema);
        this.schemaSnapshots.set(schema, snapshot);
        this.schemas.set(name, snapshot);
    }

    /**
     * Get an adapter config schema
     */
    static getSchema(name: string): Schema | undefined {
        return this.schemas.get(name);
    }

    /**
     * Get all adapter config schemas
     */
    static getAllSchemas(): Record<string, Schema> {
        return Object.fromEntries(this.schemas.entries());
    }

    /**
     * Get an adapter factory
     * @param name Adapter name/platform
     */
    static get(name: string): Adapter.Factory | undefined {
        return this.adapters.get(name);
    }

    /**
     * Check if an adapter is registered
     */
    static has(name: string): boolean {
        return this.adapters.has(name);
    }

    /**
     * Get all registered adapter names
     */
    static getAdapterNames(): string[] {
        return Array.from(this.adapters.keys());
    }

    /**
     * Get adapter metadata
     */
    static getMetadata(name: string): Adapter.Metadata | undefined {
        return this.metadata.get(name);
    }

    /**
     * Get all adapter metadata
     */
    static getAllMetadata(): Adapter.Metadata[] {
        return Array.from(this.metadata.values());
    }

    /**
     * Create an adapter instance
     */
    static create<T extends BaseApp>(
        name: string,
        app: T,
    ): Adapter<unknown, keyof Adapter.Configs, T> {
        const factory = this.get(name) as Adapter.Factory<
            Adapter<unknown, keyof Adapter.Configs, T>
        >;
        if (!factory) {
            throw new Error(`Adapter ${name} not registered`);
        }
        const adapter = invokeExtensionFactoryWithRegistryBoundary(
            `适配器 ${name}`,
            () => (Adapter.isClassAdapter(factory) ? new factory(app) : factory(app)),
            extensionRegistryBoundary,
        );
        assertAdapterFactoryContract(adapter, name, app);
        const runtimeCapabilities = normalizeAdapterCapabilities(adapter.describeCapabilities());
        const registeredCapabilities = this.metadata.get(name)?.capabilities;
        if (
            registeredCapabilities &&
            !isDeepStrictEqual(registeredCapabilities, runtimeCapabilities)
        ) {
            throw new ValidationError(`适配器 ${name} 的注册能力清单与实例默认能力不一致`, {
                context: { name },
            });
        }
        assertSupportedActionsImplemented(adapter, runtimeCapabilities);
        return adapter;
    }

    /**
     * Unregister an adapter
     */
    static unregister(name: string): boolean {
        assertExtensionRegistryMutationOpen();
        this.metadata.delete(name);
        this.schemas.delete(name);
        return this.adapters.delete(name);
    }

    /**
     * Clear all registered adapters
     */
    static clear(): void {
        assertExtensionRegistryMutationOpen();
        this.adapters.clear();
        this.metadata.clear();
        this.schemas.clear();
    }

    /** @internal 供插件加载事务捕获当前注册状态。 */
    static captureState(): ExtensionRegistryState["adapters"] {
        return {
            factories: new Map(this.adapters),
            metadata: new Map(this.metadata),
            schemas: new Map(this.schemas),
        };
    }

    /** @internal 恢复插件加载前的精确注册状态。 */
    static restoreState(state: ExtensionRegistryState["adapters"]): void {
        assertExtensionRegistryMutationOpen();
        this.adapters = new Map(state.factories);
        this.metadata = new Map(
            [...state.metadata].map(([name, metadata]) => [name, freezeAdapterMetadata(metadata)]),
        );
        this.schemas = new Map(state.schemas);
    }
}

/** 捕获 Adapter 与 Protocol 注册表，用于隔离一次插件初始化。 */
export function captureExtensionRegistryState(): ExtensionRegistryState {
    return {
        adapters: AdapterRegistry.captureState(),
        protocols: ProtocolRegistry.captureState(),
    };
}

/** 回滚一次失败插件初始化造成的全部注册表修改。 */
export function restoreExtensionRegistryState(state: ExtensionRegistryState): void {
    AdapterRegistry.restoreState(state.adapters);
    ProtocolRegistry.restoreState(state.protocols);
}

const extensionRegistryBoundary = {
    capture: captureExtensionRegistryState,
    restore: restoreExtensionRegistryState,
};

/** Schema 是插件与宿主共享的长期契约；复制并冻结容器，避免注册后的外部改写。 */
function createImmutableSchemaSnapshot(schema: Schema): Schema {
    return snapshotSchemaValue(schema, new Map<object, unknown>()) as Schema;
}

function snapshotSchemaValue(value: unknown, seen: Map<object, unknown>): unknown {
    if (typeof value !== "object" || value === null) return value;
    const existing = seen.get(value);
    if (existing !== undefined) return existing;
    if (value instanceof RegExp) {
        const snapshot = new RegExp(value.source, value.flags);
        seen.set(value, snapshot);
        return Object.freeze(snapshot);
    }
    if (value instanceof Date) {
        const target = new Date(value.getTime());
        const snapshot = createReadonlyDate(target);
        seen.set(value, snapshot);
        Object.freeze(target);
        return snapshot;
    }
    if (Array.isArray(value)) {
        const snapshot: unknown[] = [];
        seen.set(value, snapshot);
        snapshot.push(...value.map(entry => snapshotSchemaValue(entry, seen)));
        return Object.freeze(snapshot);
    }
    if (value instanceof Map) {
        const target = new Map<unknown, unknown>();
        const snapshot = createReadonlyMap(target);
        seen.set(value, snapshot);
        for (const [key, entry] of value) {
            target.set(snapshotSchemaValue(key, seen), snapshotSchemaValue(entry, seen));
        }
        Object.freeze(target);
        return snapshot;
    }
    if (value instanceof Set) {
        const target = new Set<unknown>();
        const snapshot = createReadonlySet(target);
        seen.set(value, snapshot);
        for (const entry of value) target.add(snapshotSchemaValue(entry, seen));
        Object.freeze(target);
        return snapshot;
    }
    const snapshot: Record<string, unknown> = {};
    seen.set(value, snapshot);
    for (const [key, entry] of Object.entries(value)) {
        snapshot[key] = snapshotSchemaValue(entry, seen);
    }
    return Object.freeze(snapshot);
}

function createReadonlyMap(target: Map<unknown, unknown>): Map<unknown, unknown> {
    return new Proxy(target, {
        get(map, property) {
            if (property === "set" || property === "delete" || property === "clear") {
                return rejectSchemaMutation;
            }
            const value: unknown = Reflect.get(map, property, map);
            return typeof value === "function" ? value.bind(map) : value;
        },
        set: rejectSchemaPropertyMutation,
        defineProperty: rejectSchemaPropertyMutation,
        deleteProperty: rejectSchemaPropertyMutation,
    });
}

function createReadonlySet(target: Set<unknown>): Set<unknown> {
    return new Proxy(target, {
        get(set, property) {
            if (property === "add" || property === "delete" || property === "clear") {
                return rejectSchemaMutation;
            }
            const value: unknown = Reflect.get(set, property, set);
            return typeof value === "function" ? value.bind(set) : value;
        },
        set: rejectSchemaPropertyMutation,
        defineProperty: rejectSchemaPropertyMutation,
        deleteProperty: rejectSchemaPropertyMutation,
    });
}

function createReadonlyDate(target: Date): Date {
    return new Proxy(target, {
        get(date, property) {
            if (typeof property === "string" && property.startsWith("set")) {
                return rejectSchemaMutation;
            }
            const value: unknown = Reflect.get(date, property, date);
            return typeof value === "function" ? value.bind(date) : value;
        },
        set: rejectSchemaPropertyMutation,
        defineProperty: rejectSchemaPropertyMutation,
        deleteProperty: rejectSchemaPropertyMutation,
    });
}

function rejectSchemaMutation(): never {
    throw new TypeError("注册后的配置 Schema 不可修改");
}

function rejectSchemaPropertyMutation(): false {
    return false;
}

function freezeAdapterMetadata(metadata: Adapter.Metadata): Adapter.Metadata {
    return Object.freeze({ ...metadata });
}

function freezeProtocolMetadata(metadata: Protocol.Metadata): Protocol.Metadata {
    const versions = [...metadata.versions];
    Object.freeze(versions);
    return Object.freeze({ ...metadata, versions });
}
