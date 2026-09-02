import type { Protocol } from "./protocol.js";
import { ValidationError } from "./errors.js";

export type ApplicationSupportStatus = "supported" | "unsupported";

export interface ApplicationConnection {
    id: string;
    transport: "http" | "websocket" | "reverse-websocket" | "webhook" | "sse";
    direction: "onebots-listens" | "onebots-connects";
    endpoint: string;
    description: string;
}

export interface ApplicationProtocolCapability {
    application: string;
    protocol: string;
    status: ApplicationSupportStatus;
    connections: readonly ApplicationConnection[];
    actions: readonly string[];
    routes: readonly string[];
    limitations: readonly string[];
}

export interface ApplicationStartContext {
    protocol: Protocol;
    signal?: AbortSignal;
    next(): Promise<void>;
}

export interface ApplicationStopContext {
    protocol: Protocol;
    force?: boolean;
    next(): Promise<void>;
}

export interface ApplicationApplyContext {
    protocol: Protocol;
    action: string;
    params?: unknown;
    next(action?: string, params?: unknown): Promise<unknown>;
}

export interface ApplicationDispatchContext {
    protocol: Protocol;
    event: unknown;
    next(event?: unknown): Promise<void>;
}

export interface ApplicationProtocolExtension {
    capability: Omit<ApplicationProtocolCapability, "application" | "protocol" | "status">;
    start?(context: ApplicationStartContext): void | Promise<void>;
    stop?(context: ApplicationStopContext): void | Promise<void>;
    apply?(context: ApplicationApplyContext): Promise<unknown>;
    dispatch?(context: ApplicationDispatchContext): void | Promise<void>;
}

export interface ApplicationDefinition {
    name: string;
    displayName: string;
    description: string;
    stage?: "available" | "planned";
    homepage?: string;
    createProtocolExtension(protocol: Protocol): ApplicationProtocolExtension | undefined;
    unsupportedProtocol?(protocol: Protocol): readonly string[];
}

export interface ActiveApplicationInfo {
    name: string;
    displayName: string;
    description: string;
    stage: "available";
    homepage?: string;
}

interface AttachedExtension {
    application: string;
    extension: ApplicationProtocolExtension;
}

let assertRegistryMutationOpen: () => void = () => undefined;

/** @internal 由 registry module 在加载时绑定共享的插件注册事务守卫。 */
export function configureApplicationRegistryMutationGuard(guard: () => void): void {
    if (assertRegistryMutationOpen !== noopMutationGuard) {
        throw new ValidationError("应用注册表事务守卫已经配置");
    }
    assertRegistryMutationOpen = guard;
}

function noopMutationGuard(): void {}

assertRegistryMutationOpen = noopMutationGuard;

export interface ApplicationRegistryState {
    readonly definitions: ReadonlyMap<string, ApplicationDefinition>;
    readonly active: readonly string[];
}

export function defineApplication(definition: ApplicationDefinition): ApplicationDefinition {
    return definition;
}

/**
 * Application 是作用于协议实例的运行时扩展。插件导入只负责 register，CLI 的 `-t`
 * 决定本次进程激活哪些定义；协议创建后按激活顺序组合扩展钩子。
 */
export class ApplicationRegistry {
    private static definitions = new Map<string, ApplicationDefinition>();
    private static active: string[] = [];
    private static attached = new WeakMap<Protocol, AttachedExtension[]>();

    static register(definition: ApplicationDefinition): void {
        assertRegistryMutationOpen();
        const name = normalizeApplicationName(definition.name);
        const registered = this.definitions.get(name);
        if (registered === definition) return;
        if (registered) throw new ValidationError(`应用 ${name} 已由其他实现注册`);
        if (!definition.displayName.trim()) throw new ValidationError(`应用 ${name} 缺少显示名称`);
        if (typeof definition.createProtocolExtension !== "function") {
            throw new ValidationError(`应用 ${name} 缺少协议扩展工厂`);
        }
        this.definitions.set(name, Object.freeze(definition));
    }

    static has(name: string): boolean {
        return this.definitions.has(name);
    }

    static get(name: string): ApplicationDefinition | undefined {
        return this.definitions.get(name);
    }

    static getNames(): string[] {
        return [...this.definitions.keys()];
    }

    static activate(name: string): void {
        assertRegistryMutationOpen();
        const normalized = normalizeApplicationName(name);
        const definition = this.definitions.get(normalized);
        if (!definition) {
            throw new ValidationError(`应用 ${normalized} 尚未注册`);
        }
        if (definition.stage === "planned") {
            throw new ValidationError(`应用 ${normalized} 仍处于调研阶段，尚未提供可运行扩展`);
        }
        if (!this.active.includes(normalized)) this.active.push(normalized);
    }

    static deactivate(name: string): boolean {
        assertRegistryMutationOpen();
        const normalized = normalizeApplicationName(name);
        const index = this.active.indexOf(normalized);
        if (index < 0) return false;
        this.active.splice(index, 1);
        return true;
    }

    static getActiveNames(): string[] {
        return [...this.active];
    }

    static listActive(): ActiveApplicationInfo[] {
        return this.active.flatMap(name => {
            const definition = this.definitions.get(name);
            return definition
                ? [
                      {
                          name,
                          displayName: definition.displayName,
                          description: definition.description,
                          stage: "available" as const,
                          homepage: definition.homepage,
                      },
                  ]
                : [];
        });
    }

    /** 由 ProtocolRegistry.create 在工厂契约校验后调用。 */
    static extend(protocol: Protocol): Protocol {
        const attached = this.attached.get(protocol) ?? [];
        const attachedNames = new Set(attached.map(item => item.application));
        const extensions = this.active.flatMap(application => {
            if (attachedNames.has(application)) return [];
            const definition = this.definitions.get(application);
            if (!definition) return [];
            const extension = definition.createProtocolExtension(protocol);
            return extension ? [{ application, extension }] : [];
        });
        this.attached.set(protocol, [...attached, ...extensions]);
        if (extensions.length) composeProtocolExtensions(protocol, extensions);
        return protocol;
    }

    static describeProtocol(protocol: Protocol): ApplicationProtocolCapability[] {
        const attached = new Map(
            (this.attached.get(protocol) ?? []).map(item => [item.application, item.extension]),
        );
        return this.active.flatMap(application => {
            const definition = this.definitions.get(application);
            if (!definition) return [];
            const extension = attached.get(application);
            const protocolIdentity = `${protocol.name}.${protocol.version}`;
            if (!extension) {
                return [
                    freezeCapability({
                        application,
                        protocol: protocolIdentity,
                        status: "unsupported",
                        connections: [],
                        actions: [],
                        routes: [],
                        limitations: [
                            ...(definition.unsupportedProtocol?.(protocol) ?? [
                                `${definition.displayName} 暂不支持 ${protocolIdentity}`,
                            ]),
                        ],
                    }),
                ];
            }
            return [
                freezeCapability({
                    application,
                    protocol: protocolIdentity,
                    status: "supported",
                    ...extension.capability,
                }),
            ];
        });
    }

    /** @internal 供插件加载事务捕获状态。 */
    static captureState(): ApplicationRegistryState {
        return Object.freeze({
            definitions: readonlyMap(this.definitions),
            active: Object.freeze([...this.active]),
        });
    }

    /** @internal 由宿主回滚失败的插件导入。 */
    static restoreState(state: ApplicationRegistryState): void {
        assertRegistryMutationOpen();
        this.definitions = new Map(state.definitions);
        this.active = [...state.active];
    }

    /** @internal 仅供测试隔离进程级状态。 */
    static clear(): void {
        assertRegistryMutationOpen();
        this.definitions.clear();
        this.active = [];
        this.attached = new WeakMap();
    }
}

function readonlyMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
    const target = new Map(source);
    return new Proxy(target, {
        get(map, property) {
            if (property === "set" || property === "delete" || property === "clear") {
                return () => {
                    throw new TypeError("应用注册表快照不可修改");
                };
            }
            const value: unknown = Reflect.get(map, property, map);
            return typeof value === "function" ? value.bind(map) : value;
        },
    });
}

function composeProtocolExtensions(protocol: Protocol, attached: AttachedExtension[]): void {
    const start = protocol.start.bind(protocol);
    const stop = protocol.stop.bind(protocol);
    const apply = protocol.apply.bind(protocol);
    const dispatch = protocol.dispatch.bind(protocol);

    protocol.start = signal =>
        runStartHook(protocol, attached, 0, signal, () => Promise.resolve(start(signal)));
    protocol.stop = force =>
        runStopHook(protocol, [...attached].reverse(), 0, force, () =>
            Promise.resolve(stop(force)),
        );
    protocol.apply = (action, params) =>
        runApplyHook(protocol, attached, 0, action, params, (nextAction, nextParams) =>
            apply(nextAction, nextParams),
        );
    protocol.dispatch = event =>
        runDispatchHook(protocol, attached, 0, event, nextEvent =>
            Promise.resolve(dispatch(nextEvent)),
        );
}

function runStartHook(
    protocol: Protocol,
    attached: AttachedExtension[],
    index: number,
    signal: AbortSignal | undefined,
    terminal: () => Promise<void>,
): Promise<void> {
    const hook = attached[index]?.extension.start;
    if (!hook) {
        return index >= attached.length
            ? terminal()
            : runStartHook(protocol, attached, index + 1, signal, terminal);
    }
    return Promise.resolve(
        hook({
            protocol,
            signal,
            next: () => runStartHook(protocol, attached, index + 1, signal, terminal),
        }),
    );
}

function runStopHook(
    protocol: Protocol,
    attached: AttachedExtension[],
    index: number,
    force: boolean | undefined,
    terminal: () => Promise<void>,
): Promise<void> {
    const hook = attached[index]?.extension.stop;
    if (!hook) {
        return index >= attached.length
            ? terminal()
            : runStopHook(protocol, attached, index + 1, force, terminal);
    }
    return Promise.resolve(
        hook({
            protocol,
            force,
            next: () => runStopHook(protocol, attached, index + 1, force, terminal),
        }),
    );
}

function runApplyHook(
    protocol: Protocol,
    attached: AttachedExtension[],
    index: number,
    action: string,
    params: unknown,
    terminal: (action: string, params: unknown) => Promise<unknown>,
): Promise<unknown> {
    const hook = attached[index]?.extension.apply;
    if (!hook) {
        return index >= attached.length
            ? terminal(action, params)
            : runApplyHook(protocol, attached, index + 1, action, params, terminal);
    }
    return hook({
        protocol,
        action,
        params,
        next: (nextAction = action, nextParams = params) =>
            runApplyHook(protocol, attached, index + 1, nextAction, nextParams, terminal),
    });
}

function runDispatchHook(
    protocol: Protocol,
    attached: AttachedExtension[],
    index: number,
    event: unknown,
    terminal: (event: unknown) => Promise<void>,
): Promise<void> {
    const hook = attached[index]?.extension.dispatch;
    if (!hook) {
        return index >= attached.length
            ? terminal(event)
            : runDispatchHook(protocol, attached, index + 1, event, terminal);
    }
    return Promise.resolve(
        hook({
            protocol,
            event,
            next: (nextEvent = event) =>
                runDispatchHook(protocol, attached, index + 1, nextEvent, terminal),
        }),
    );
}

function normalizeApplicationName(name: string): string {
    const normalized = name.trim();
    if (normalized !== name || !/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) {
        throw new ValidationError(`应用名称无效：${name}`);
    }
    return normalized;
}

function freezeCapability(
    capability: ApplicationProtocolCapability,
): ApplicationProtocolCapability {
    return Object.freeze({
        ...capability,
        connections: Object.freeze(
            capability.connections.map(connection => Object.freeze({ ...connection })),
        ),
        actions: Object.freeze([...capability.actions]),
        routes: Object.freeze([...capability.routes]),
        limitations: Object.freeze([...capability.limitations]),
    });
}
