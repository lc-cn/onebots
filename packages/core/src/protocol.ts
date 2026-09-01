import { EventEmitter } from "node:events";
import { Account } from "./account.js";
import { Adapter } from "./adapter.js";
import { Dict } from "./types.js";
import { Router } from "./router.js";
import type { ValidationRule } from "./config-validator.js";
import {
    compileEventFilter,
    type EventFilterPredicate,
    type EventFilters,
} from "./event-filter.js";

/**
 * Base Protocol class
 * Represents a communication protocol (e.g., OneBot, Milky, Satori)
 */
export abstract class Protocol<V extends string = string, C = unknown> extends EventEmitter {
    readonly #eventFilter: EventFilterPredicate;
    /** 由 Account 生命周期编排维护，供 readiness 与运维诊断使用。 */
    public lifecycleStatus: ProtocolLifecycleStatus = "pending";
    public abstract readonly name: string;
    public abstract readonly version: V;
    get app() {
        return this.adapter.app;
    }
    get router(): Router {
        return this.adapter.app.router;
    }
    get logger() {
        return this.app.getLogger(`${this.name}/${this.version}`);
    }
    constructor(
        public adapter: Adapter,
        public account: Account,
        public config: Protocol.FullConfig<C>,
    ) {
        super();
        this.#eventFilter = compileEventFilter(config.filters);
    }

    /**
     * Get the URL path for this protocol
     */
    get path(): string {
        return `${this.account.path}/${this.config.protocol}/${this.config.version}`;
    }

    /**
     * Filter function to determine if event should be processed
     */
    filterFn(event: Dict): boolean {
        return this.#eventFilter(event);
    }

    /**
     * Start the protocol service
     */
    /** 启动协议出口；账号启动超时时 signal 会被中止，协议应据此尽快释放未完成工作。 */
    abstract start(signal?: AbortSignal): void | Promise<void>;

    /**
     * Stop the protocol service
     */
    abstract stop(force?: boolean): void | Promise<void>;

    /**
     * Dispatch an event through this protocol
     */
    abstract dispatch(event: unknown): void | Promise<void>;

    /**
     * Format event data according to protocol specifications
     */
    abstract format(event: string, payload: unknown): unknown;

    /**
     * Apply an action (call an API method)
     */
    abstract apply(action: string, params?: unknown): Promise<unknown>;
}

export type ProtocolLifecycleStatus =
    | "pending"
    | "starting"
    | "ready"
    | "stopping"
    | "stopped"
    | "failed";

export namespace Protocol {
    /**
     * Base configuration for protocols
     */
    export type Config<T extends unknown = Record<string, unknown>> = T & {
        filters?: Filters;
    };
    export type FullConfig<T extends unknown = Record<string, unknown>> = Config<T> & {
        protocol: string;
        version: string;
    };
    export interface Configs {}

    /**
     * Filter configuration
     */
    export type Filters = EventFilters;

    /** 所有协议共享的事件过滤器表单契约。 */
    export const FilterSchema = {
        type: "object",
        default: {},
        label: "事件过滤",
        description: "默认转发全部事件；添加规则后，只转发符合条件的事件。",
        ui: {
            widget: "event-filter",
            section: "filter",
            eventFields: [
                {
                    path: "type",
                    label: "事件类别",
                    choices: [
                        { value: "message", label: "消息" },
                        { value: "notice", label: "通知" },
                        { value: "request", label: "请求" },
                        { value: "meta", label: "元事件" },
                    ],
                },
                {
                    path: "message_type",
                    label: "消息场景",
                    choices: [
                        { value: "private", label: "私聊" },
                        { value: "group", label: "群聊" },
                        { value: "channel", label: "频道" },
                        { value: "direct", label: "频道私信" },
                    ],
                },
                { path: "notice_type", label: "通知类型" },
                {
                    path: "sub_type",
                    label: "事件子类型",
                },
                { path: "request_type", label: "请求类型" },
                { path: "meta_type", label: "元事件类型" },
                { path: "platform", label: "平台" },
                { path: "bot_id.string", label: "机器人 ID" },
                { path: "sender.id.string", label: "发送者 ID" },
                { path: "group.id.string", label: "群组 / 频道 ID" },
                { path: "raw_message", label: "消息文本" },
            ],
        },
    } satisfies ValidationRule;

    /**
     * Protocol metadata
     */
    export interface Metadata {
        name: string;
        displayName: string;
        description: string;
        versions: string[];
    }
    export type Creator<T extends Protocol = Protocol> = (
        adapter: Adapter,
        account: Account,
        config: Record<string, unknown>,
    ) => T;
    export type Construct<T extends Protocol = Protocol> = {
        new (adapter: Adapter, account: Account, config: Record<string, unknown>): T;
    };
    /**
     * Protocol factory function
     */
    export type Factory<T extends Protocol = Protocol> = Creator<T> | Construct<T>;
    export function isClassFactory<T extends Protocol = Protocol>(
        factory: Factory<T>,
    ): factory is Construct<T> {
        return (
            typeof factory === "function" &&
            /^class\s/.test(Function.prototype.toString.call(factory))
        );
    }
}
