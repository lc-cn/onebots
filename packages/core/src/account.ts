import { EventEmitter } from "node:events";
import { deepClone, deepMerge } from "./utils.js";
import { Adapter } from "./adapter.js";
import { Logger } from "log4js";
import { ProtocolRegistry } from "./registry.js";
import { Protocol, type ProtocolLifecycleStatus } from "./protocol.js";
import { CommonEvent } from "./types.js";
import { emitAllAwaited, FailureCollector } from "./async-utils.js";
import { ResourceError } from "./errors.js";
import type { RouterRegistrationScope } from "./router.js";
import {
    beginAccountOperationDrain,
    closeAccountOperations,
    openAccountOperations,
    AccountOperationRejectedError,
    runAccountOperation,
    type AccountOperationDrain,
} from "./account-operations.js";

export interface ProtocolRuntimeInfo {
    name: string;
    version: string;
    path: string;
    lifecycleStatus: ProtocolLifecycleStatus;
}

const MAX_TIMER_SECONDS = 2_147_483_647 / 1000;

export class NotFoundError extends Error {
    message = "不支持的API";
}

export class Account<
    P extends keyof Adapter.Configs = keyof Adapter.Configs,
    C = unknown,
> extends EventEmitter {
    status: AccountStatus;
    avatar: string;
    nickname: string;
    dependency: string;
    #logger: Logger;
    #startGeneration = 0;
    #starting?: Promise<void>;
    #startController?: AbortController;
    #routeScope?: RouterRegistrationScope;
    readonly #protocolScopes = new Map<Protocol, RouterRegistrationScope>();
    protocols: Protocol[];
    get account_id() {
        return this.config.account_id;
    }
    /** 热配置不能与尚未完成的平台登录事务交错。 */
    get isStarting(): boolean {
        return this.#starting !== undefined;
    }
    runOperation<T>(operation: () => T | Promise<T>): Promise<T> {
        return runAccountOperation(this, operation);
    }

    beginOperationDrain(): AccountOperationDrain {
        return beginAccountOperationDrain(this);
    }
    get app() {
        return this.adapter.app;
    }

    get platform() {
        return this.adapter.platform;
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(String(this.platform)));
    }

    get info() {
        return {
            uin: this.account_id,
            status: this.status,
            platform: this.platform,
            avatar: this.avatar,
            nickname: this.nickname,
            dependency: this.dependency,
            urls: this.protocols.map(protocol => protocol.path),
            protocols: this.protocols.map(
                (protocol): ProtocolRuntimeInfo => ({
                    name: protocol.name,
                    version: protocol.version,
                    path: protocol.path,
                    lifecycleStatus: protocol.lifecycleStatus,
                }),
            ),
            startupTimeoutSeconds: this.startupTimeoutSeconds,
        };
    }

    get startupTimeoutSeconds(): number {
        const globalSeconds = this.app.config.timeout ?? 30;
        const requestedSeconds = this.adapter.resolveAccountStartupTimeoutSeconds(this.config);
        const effectiveSeconds = Math.max(globalSeconds, requestedSeconds);
        if (
            !Number.isFinite(effectiveSeconds) ||
            effectiveSeconds <= 0 ||
            effectiveSeconds > MAX_TIMER_SECONDS
        ) {
            throw new ResourceError(
                `账号 ${this.platform}/${this.account_id} 的启动超时必须是有效正数秒`,
            );
        }
        return effectiveSeconds;
    }
    get protocolConfigs(): Protocol.FullConfig<C>[] {
        const result: Protocol.FullConfig<C>[] = [];
        Object.keys(this.config).forEach(key => {
            const [protocol, version] = key.split(".");
            if (ProtocolRegistry.has(protocol, version)) {
                const config = this.config[key] || {};
                const general = this.app.config.general[key] || {};
                const merged = deepMerge(deepClone(general), deepClone(config)) as Record<
                    string,
                    unknown
                >;
                result.push({
                    ...merged,
                    protocol,
                    version,
                } as Protocol.FullConfig<C>);
            }
        });
        return result;
    }
    constructor(
        public adapter: Adapter<C>,
        public client: C,
        public config: Account.Config<P>,
    ) {
        super();
        this.protocols = this.protocolConfigs.map(
            ({ protocol, version, ...config }: Protocol.FullConfig<C>) => {
                const instance = this.createProtocol(protocol, version, config);
                return instance;
            },
        );
        this.status = AccountStatus.Pending;
    }

    /** 构造与启动各自捕获协议资源；协议变更不触碰账号自身路由。 */
    createProtocol(name: string, version: string, config: Record<string, unknown>): Protocol {
        const scope = this.app.router?.createRegistrationScope({
            platform: String(this.platform),
            account_id: String(this.account_id),
        });
        try {
            const create = () => ProtocolRegistry.create(name, version, this.adapter, this, config);
            const protocol = scope ? scope.run(create) : create();
            if (scope) this.#protocolScopes.set(protocol, scope);
            const apply = protocol.apply.bind(protocol);
            protocol.apply = (action, params) => {
                if (protocol.lifecycleStatus !== "ready" || !this.protocols.includes(protocol))
                    return Promise.reject(new AccountOperationRejectedError());
                return this.runOperation(() => apply(action, params));
            };
            // 调试旁路异常不能阻断协议实际投递，热创建与冷启动采用同一观测路径。
            protocol.on("dispatch", (data: unknown) => {
                try {
                    this.adapter.emit("message:protocol-dispatch", {
                        platform: this.platform,
                        account_id: this.account_id,
                        protocol: protocol.name,
                        version: protocol.version,
                        data,
                    });
                } catch (error) {
                    this.logger.debug("message:protocol-dispatch 旁路监听器异常（已忽略）:", error);
                }
            });
            return protocol;
        } catch (error) {
            scope?.close();
            throw error;
        }
    }

    async startProtocol(protocol: Protocol, signal?: AbortSignal): Promise<void> {
        if (!this.#protocolScopes.has(protocol) && this.app.router) {
            this.#protocolScopes.set(
                protocol,
                this.app.router.createRegistrationScope({
                    platform: String(this.platform),
                    account_id: String(this.account_id),
                }),
            );
        }
        protocol.lifecycleStatus = "starting";
        const start = () => {
            const router = this.app.router;
            return router
                ? router.runWithProtocolReadiness(
                      () => protocol.lifecycleStatus === "ready",
                      () => protocol.start(signal),
                  )
                : protocol.start(signal);
        };
        try {
            const scope = this.#protocolScopes.get(protocol);
            await (scope ? scope.run(start) : start());
            if (signal?.aborted)
                throw new ResourceError(
                    `账号 ${this.platform}/${this.account_id} 的启动任务已失效`,
                );
            protocol.lifecycleStatus = "ready";
        } catch (error) {
            if (protocol.lifecycleStatus === "starting") protocol.lifecycleStatus = "failed";
            throw error;
        }
    }

    async stopProtocol(protocol: Protocol, force?: boolean): Promise<void> {
        protocol.lifecycleStatus = "stopping";
        this.#protocolScopes.get(protocol)?.close();
        this.#protocolScopes.delete(protocol);
        try {
            await protocol.stop(force);
            protocol.lifecycleStatus = "stopped";
        } catch (error) {
            protocol.lifecycleStatus = "failed";
            throw error;
        }
    }

    /** @internal 由 BaseApp 在账号构造完成后绑定路由所有权。 */
    attachRouteScope(scope: RouterRegistrationScope): void {
        this.#routeScope = scope;
    }
    get path() {
        return `/${this.platform}/${this.account_id}`;
    }

    /**
     * 在全局 timeout 边界内启动账号监听器和协议出口。
     * start 监听器会收到 AbortSignal；超时或 stop 时扩展应据此取消底层异步工作。
     */
    start(): Promise<void> {
        if (this.#starting) return this.#starting;
        openAccountOperations(this);
        const generation = ++this.#startGeneration;
        const controller = new AbortController();
        this.#startController = controller;
        const timeoutSeconds = this.startupTimeoutSeconds;
        let timeout: NodeJS.Timeout | undefined;
        const operation = this.#routeScope
            ? this.#routeScope.run(() => this.#startAttempt(controller.signal, generation))
            : this.#startAttempt(controller.signal, generation);
        const bounded = Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    if (generation !== this.#startGeneration) return;
                    this.#startGeneration += 1;
                    controller.abort();
                    this.status = AccountStatus.OffLine;
                    for (const protocol of this.protocols) {
                        if (protocol.lifecycleStatus === "starting") {
                            protocol.lifecycleStatus = "failed";
                        }
                    }
                    reject(
                        new ResourceError(
                            `账号 ${this.platform}/${this.account_id} 启动超过 ${timeoutSeconds} 秒`,
                        ),
                    );
                }, timeoutSeconds * 1000);
                timeout.unref?.();
            }),
        ]).finally(() => {
            if (timeout) clearTimeout(timeout);
            if (this.#starting === bounded) {
                this.#starting = undefined;
                this.#startController = undefined;
            }
        });
        this.#starting = bounded;
        return bounded;
    }

    async #startAttempt(signal: AbortSignal, generation: number): Promise<void> {
        this.logger.info(`Starting account ${this.account_id}`);
        await this.#startListeners(signal, generation);
        this.#assertStartCurrent(generation);
        for (const protocol of this.protocols) {
            try {
                await this.startProtocol(protocol, signal);
                this.#assertStartCurrent(generation);
                protocol.lifecycleStatus = "ready";
            } catch (error) {
                if (generation === this.#startGeneration) protocol.lifecycleStatus = "failed";
                throw error;
            }
        }
    }

    async #startListeners(signal: AbortSignal, generation: number): Promise<void> {
        const failures = new FailureCollector();
        // 启动有取消边界；不能复用必须尝试全部清理监听器的通用广播。
        for (const listener of this.rawListeners("start")) {
            this.#assertStartCurrent(generation);
            await failures.capture(() => Reflect.apply(listener, this, [signal]));
            this.#assertStartCurrent(generation);
        }
        failures.throwIfAny("账号启动监听器失败");
    }

    #assertStartCurrent(generation: number): void {
        if (generation !== this.#startGeneration) {
            throw new ResourceError(`账号 ${this.platform}/${this.account_id} 的启动任务已失效`);
        }
    }

    async stop(force?: boolean): Promise<void> {
        closeAccountOperations(this);
        this.#startGeneration += 1;
        this.#startController?.abort();
        this.#startController = undefined;
        this.#starting = undefined;
        this.#routeScope?.close();
        this.#routeScope = undefined;
        const failures = new FailureCollector();
        for (const protocol of this.protocols) {
            await failures.capture(() => this.stopProtocol(protocol, force));
        }
        // Account 支持显式 stop/start；保留生命周期监听器，下一次 start 才能重建连接与路由。
        await failures.capture(() => emitAllAwaited(this, "stop"));
        failures.throwIfAny(`${failures.size} 个账号停止操作失败`);
    }

    getGroupList() {
        return this.runOperation(() => this.adapter.getGroupList(this.account_id));
    }

    getFriendList() {
        return this.runOperation(() => this.adapter.getFriendList(this.account_id));
    }

    /** 将事件发往各协议，但不把完成状态反馈给调用方。可靠接入应使用 dispatchAwaited。 */
    dispatch(commonEvent: CommonEvent.Base): void {
        void this.dispatchAwaited(commonEvent).catch(error => {
            this.logger.error(`Dispatching event failed:`, error);
        });
    }

    /**
     * 将事件发往全部协议并等待完成。单个协议失败不会阻止其他协议获得本次投递，
     * 但最终会向接入层传播失败，使 Webhook、队列或 Stream 可以请求平台重投。
     */
    async dispatchAwaited(commonEvent: CommonEvent.Base): Promise<void> {
        return this.runOperation(() => this.dispatchProtocolsAwaited(commonEvent));
    }

    private async dispatchProtocolsAwaited(commonEvent: CommonEvent.Base): Promise<void> {
        this.logger.debug(
            `Dispatching event: ${commonEvent.type} to ${this.protocols.length} protocol(s)`,
        );
        // 调试观测用的旁路 emit：绝不能抛出并阻断下面真正的协议分发循环。
        try {
            this.adapter.emit("message:dispatch", {
                platform: this.platform,
                account_id: this.account_id,
                event: commonEvent,
            });
        } catch (error) {
            this.logger.debug(`message:dispatch 旁路监听器异常（已忽略）:`, error);
        }
        const deliveries: Promise<void>[] = [];
        for (const protocol of this.protocols) {
            this.logger.debug(`Dispatching to protocol: ${protocol.name}/${protocol.version}`);
            try {
                deliveries.push(Promise.resolve(protocol.dispatch(commonEvent)));
            } catch (error) {
                deliveries.push(Promise.reject(error));
            }
        }
        const failures = (await Promise.allSettled(deliveries))
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map(result => result.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
            throw new AggregateError(failures, `${failures.length} 个协议投递失败`);
        }
    }

    /**
     * 顺序投递同一原始事件拆出的 canonical 事件，并确保单项失败不阻止其余项。
     * 全部项均获得投递机会后，再将失败聚合反馈给可靠接入层。
     */
    async dispatchManyAwaited(commonEvents: readonly CommonEvent.Base[]): Promise<void> {
        const failures = new FailureCollector();
        for (const commonEvent of commonEvents) {
            await failures.capture(() => this.dispatchAwaited(commonEvent));
        }
        failures.throwIfAny(`${failures.size} 个 canonical 事件投递失败`);
    }
}

export enum AccountStatus {
    Pending = "pending", // 上线中
    Online = "online", // 已上线
    OffLine = "offline", // 已离线
}

export namespace Account {
    export type Filters = {};
    export type Config<P extends keyof Adapter.Configs = keyof Adapter.Configs> =
        Adapter.Configs[P] &
            Partial<Protocol.Configs> & {
                platform: string;
                account_id: string;
            };
    export const UnsupportedMethodError = new Error("不支持的方法");
    export const UnsupportedVersionError = new Error("不支持的Account版本");
}
export const BOOLS = [
    "no_cache",
    "auto_escape",
    "as_long",
    "enable",
    "reject_add_request",
    "is_dismiss",
    "approve",
    "block",
];
