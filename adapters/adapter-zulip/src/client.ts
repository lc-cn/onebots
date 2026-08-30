import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { FailureCollector } from "onebots";
import { assertZulipConfig, resolveZulipReceiveMode } from "./config.js";
import { deliverZulipEvent, ZulipEventIngress } from "./event-ingress.js";
import { isBadEventQueue, ZulipError } from "./errors.js";
import { assertZulipApiPath, createZulipTransport, type ZulipTransport } from "./http.js";
import {
    parseZulipEventsResponse,
    parseZulipMessageResponse,
    parseZulipQueueRegistration,
    parseZulipSendMessageResponse,
    parseZulipStreamsResponse,
    parseZulipSubscribersResponse,
    parseZulipUploadResponse,
    parseZulipUser,
    parseZulipUserResponse,
    parseZulipUsersResponse,
} from "./responses.js";
import type {
    ZulipConfig,
    ZulipBaseEvent,
    ZulipEvent,
    ZulipEventType,
    ZulipHttpMethod,
    ZulipParams,
    ZulipQueueRegistration,
    ZulipSendMessageParams,
    ZulipUploadResponse,
    ZulipUser,
} from "./types.js";

const DEFAULT_EVENT_TYPES = [
    "heartbeat",
    "message",
    "update_message",
    "delete_message",
    "reaction",
    "subscription",
    "stream",
    "realm_user",
    "user_group",
    "invites_changed",
    "alert_words",
    "muted_users",
    "realm_linkifiers",
    "presence",
    "user_status",
    "typing",
    "restart",
] as const;

interface ZulipLifecycleEvents {
    ready: [registration?: ZulipQueueRegistration];
    stop: [];
    connected: [registration: ZulipQueueRegistration];
    disconnected: [error: ZulipError];
    raw_event: [event: ZulipEvent];
    event: [event: ZulipEvent];
    client_error: [error: ZulipError];
}

type ZulipEventFor<K extends ZulipEventType> =
    Extract<ZulipEvent, { type: K }> extends never
        ? ZulipBaseEvent & { type: K }
        : Extract<ZulipEvent, { type: K }>;

export type ZulipClientEvents = ZulipLifecycleEvents & {
    [K in ZulipEventType]: [event: ZulipEventFor<K>];
};

export interface ZulipClientOptions {
    transport?: ZulipTransport;
    sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

/** 可独立嵌入的 Zulip REST API 与可靠 Event Queue 客户端。 */
export class ZulipClient extends EventEmitter<ZulipClientEvents> {
    private readonly transportRequest: Promise<ZulipTransport>;
    private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
    private readonly eventIngress = new ZulipEventIngress();
    private lifecycleAbort?: AbortController;
    private lifecycleGeneration = 0;
    private startRequest?: Promise<void>;
    private pollRequest?: Promise<void>;
    private registration?: ZulipQueueRegistration;
    private me?: ZulipUser;
    private started = false;

    constructor(
        readonly config: ZulipConfig,
        options: ZulipClientOptions = {},
    ) {
        super();
        assertZulipConfig(config);
        this.transportRequest = options.transport
            ? Promise.resolve(options.transport)
            : createZulipTransport(config);
        this.sleep = options.sleep || abortableSleep;
    }

    /** 校验凭证并注册 Event Queue；重复调用保持幂等。 */
    async start(): Promise<void> {
        if (this.startRequest) return this.startRequest;
        if (this.started) return;
        const request = this.initialize();
        this.startRequest = request;
        try {
            await request;
        } finally {
            if (this.startRequest === request) this.startRequest = undefined;
        }
    }

    private async initialize(): Promise<void> {
        const generation = ++this.lifecycleGeneration;
        const controller = new AbortController();
        this.lifecycleAbort = controller;
        this.started = true;
        try {
            this.me = await this.getMe(controller.signal);
            if (resolveZulipReceiveMode(this.config) === "event_queue") {
                this.registration = await this.registerQueue(controller.signal);
                this.safeEmit("connected", this.registration);
                this.pollRequest = this.pollEvents(generation, controller.signal);
            }
            this.safeEmit("ready", this.registration);
        } catch (error) {
            controller.abort();
            if (generation === this.lifecycleGeneration) {
                this.started = false;
                this.lifecycleAbort = undefined;
                this.registration = undefined;
                this.me = undefined;
            }
            throw ZulipError.wrap(error, "ZULIP_START_FAILED");
        }
    }

    /** 停止长轮询并删除服务器队列；重复调用安全。 */
    async stop(): Promise<void> {
        if (!this.started && !this.startRequest) return;
        const failures = new FailureCollector();
        const registration = this.registration;
        const pollRequest = this.pollRequest;
        this.started = false;
        this.lifecycleGeneration += 1;
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        this.registration = undefined;
        this.startRequest = undefined;
        this.pollRequest = undefined;
        this.me = undefined;
        try {
            await pollRequest;
        } catch (error) {
            const wrapped = ZulipError.wrap(error, "ZULIP_EVENT_QUEUE_STOP_FAILED");
            failures.add(wrapped);
            this.reportError(wrapped);
        }
        if (registration?.queue_id) {
            try {
                await this.call("events", "DELETE", { queue_id: registration.queue_id });
            } catch (error) {
                const wrapped = ZulipError.wrap(error, "ZULIP_QUEUE_DELETE_FAILED");
                failures.add(wrapped);
                this.reportError(wrapped);
            }
        }
        this.safeEmit("stop");
        failures.throwIfAny("Zulip 客户端停止失败");
    }

    /** 调用官方相对 API 路径；路径、方法、编码和平台错误均统一校验。 */
    async call(
        path: string,
        method: ZulipHttpMethod = "GET",
        params: ZulipParams = {},
        signal?: AbortSignal,
        timeoutMs?: number,
    ): Promise<unknown> {
        const transport = await this.transportRequest;
        return transport({
            method,
            path: assertZulipApiPath(path),
            params,
            signal,
            timeoutMs,
        });
    }

    /** 将已有 Event Queue、代理或测试连接取得的原始事件送入同一事件管线。 */
    ingest(event: unknown): Promise<boolean> {
        return this.eventIngress.ingest(event, validEvent => deliverZulipEvent(this, validEvent));
    }

    /** 返回启动认证阶段取得的 Bot 身份，不额外发起 HTTP 请求。 */
    getCachedMe(): ZulipUser | undefined {
        return this.me ? { ...this.me } : undefined;
    }

    /** 获取当前 Bot 身份。 */
    getMe(signal?: AbortSignal): Promise<ZulipUser> {
        return this.request("users/me", "GET", {}, parseZulipUser, signal);
    }

    /** 获取一个组织成员。 */
    async getUser(userId: number, signal?: AbortSignal): Promise<ZulipUser> {
        const response = await this.request(
            `users/${userId}`,
            "GET",
            {},
            parseZulipUserResponse,
            signal,
        );
        return response.user;
    }

    /** 获取当前凭证可访问的组织成员。 */
    async getUsers(): Promise<ZulipUser[]> {
        const response = await this.request(
            "users",
            "GET",
            { client_gravatar: false },
            parseZulipUsersResponse,
        );
        return response.members;
    }

    /** 获取当前凭证可访问的频道。 */
    async getStreams() {
        return this.request(
            "streams",
            "GET",
            { include_all: true, exclude_archived: false },
            parseZulipStreamsResponse,
        );
    }

    /** 获取频道订阅成员 ID。 */
    async getSubscribers(streamId: number): Promise<number[]> {
        const response = await this.request(
            `streams/${streamId}/members`,
            "GET",
            {},
            parseZulipSubscribersResponse,
        );
        return response.subscribers;
    }

    /** 获取单条消息及原始 Markdown。 */
    getMessage(messageId: number) {
        return this.request(`messages/${messageId}`, "GET", {}, parseZulipMessageResponse);
    }

    /** 发送频道消息或私聊消息。 */
    sendMessage(params: ZulipSendMessageParams) {
        return this.request(
            "messages",
            "POST",
            {
                type: params.type,
                to: params.to,
                topic: params.topic,
                content: params.content,
                client: params.client || "OneBots",
            },
            parseZulipSendMessageResponse,
        );
    }

    /** 更新消息正文及可选话题。 */
    updateMessage(messageId: number, content: string, topic?: string): Promise<unknown> {
        return this.call(`messages/${messageId}`, "PATCH", { content, topic });
    }

    /** 删除消息。 */
    deleteMessage(messageId: number): Promise<unknown> {
        return this.call(`messages/${messageId}`, "DELETE");
    }

    /** 添加或移除消息反应。 */
    setReaction(
        messageId: number,
        operation: "add" | "remove",
        emojiName: string,
        emojiCode?: string,
        reactionType?: string,
    ): Promise<unknown> {
        return this.call(
            `messages/${messageId}/reactions`,
            operation === "add" ? "POST" : "DELETE",
            { emoji_name: emojiName, emoji_code: emojiCode, reaction_type: reactionType },
        );
    }

    /** 为消息增加或移除 read/starred/collapsed 标记。 */
    updateMessageFlag(
        messageIds: readonly number[],
        operation: "add" | "remove",
        flag: "read" | "starred" | "collapsed",
    ): Promise<unknown> {
        return this.call("messages/flags", "POST", {
            messages: messageIds,
            op: operation,
            flag,
        });
    }

    /** 上传文件并返回可写入 Markdown 的组织内 URL。 */
    async upload(
        data: Uint8Array,
        filename: string,
        mimeType?: string,
    ): Promise<ZulipUploadResponse> {
        const boundary = `----onebots-${randomBytes(12).toString("hex")}`;
        const prefix = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="${escapeFilename(filename)}"\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`,
        );
        const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
        const transport = await this.transportRequest;
        const response = await transport({
            method: "POST",
            path: "user_uploads",
            body: Buffer.concat([prefix, Buffer.from(data), suffix]),
            contentType: `multipart/form-data; boundary=${boundary}`,
        });
        return parseZulipUploadResponse(response);
    }

    private async registerQueue(signal: AbortSignal): Promise<ZulipQueueRegistration> {
        const configuredEventTypes = this.config.event_queue?.event_types;
        return this.request(
            "register",
            "POST",
            {
                event_types: configuredEventTypes?.length
                    ? configuredEventTypes
                    : DEFAULT_EVENT_TYPES,
                all_public_streams: this.config.event_queue?.all_public_streams || false,
                apply_markdown: false,
                client_capabilities: {
                    empty_topic_name: true,
                    include_deactivated_groups: true,
                    linkifier_url_template: true,
                    user_avatar_url_field_optional: true,
                    user_list_incomplete: true,
                    simplified_presence_events: true,
                },
            },
            parseZulipQueueRegistration,
            signal,
        );
    }

    private async pollEvents(generation: number, signal: AbortSignal): Promise<void> {
        let failures = 0;
        while (this.started && generation === this.lifecycleGeneration && !signal.aborted) {
            try {
                let registration = this.registration;
                if (!registration) {
                    registration = await this.registerQueue(signal);
                    this.registration = registration;
                    this.safeEmit("connected", registration);
                }
                const recovering = failures > 0;
                const response = await this.request(
                    "events",
                    "GET",
                    { queue_id: registration.queue_id, last_event_id: registration.last_event_id },
                    parseZulipEventsResponse,
                    signal,
                    longPollTimeoutMs(registration),
                );
                failures = 0;
                if (recovering) this.safeEmit("connected", registration);
                for (const event of response.events) {
                    await this.ingest(event);
                    registration.last_event_id = event.id;
                }
            } catch (error) {
                if (signal.aborted) return;
                const wrapped = ZulipError.wrap(error, "ZULIP_EVENT_QUEUE_FAILED");
                this.safeEmit("disconnected", wrapped);
                this.reportError(wrapped);
                if (isBadEventQueue(wrapped)) this.registration = undefined;
                failures += 1;
                try {
                    await this.sleep(this.retryDelay(failures), signal);
                } catch (sleepError) {
                    if (signal.aborted) return;
                    throw sleepError;
                }
            }
        }
    }

    private retryDelay(failures: number): number {
        const initial = this.config.event_queue?.retry_initial_delay_ms ?? 1_000;
        const maximum = this.config.event_queue?.retry_max_delay_ms ?? 30_000;
        return Math.min(maximum, initial * 2 ** Math.min(failures - 1, 10));
    }

    private reportError(error: ZulipError): void {
        this.safeEmit("client_error", error);
    }

    private async request<T>(
        path: string,
        method: ZulipHttpMethod,
        params: ZulipParams,
        parse: (value: unknown) => T,
        signal?: AbortSignal,
        timeoutMs?: number,
    ): Promise<T> {
        return parse(await this.call(path, method, params, signal, timeoutMs));
    }

    private safeEmit<K extends keyof ZulipClientEvents>(
        name: K,
        ...args: ZulipClientEvents[K]
    ): void {
        this.safeEmitName(String(name), ...args);
    }

    /** 逐个调用 raw listener，既保留 once 语义，也隔离同名监听器的异常。 */
    private safeEmitName(name: string, ...args: unknown[]): void {
        for (const listener of this.rawListeners(name)) {
            try {
                Reflect.apply(listener, this, args);
            } catch (error) {
                if (name !== "client_error") {
                    this.safeEmitName(
                        "client_error",
                        ZulipError.wrap(error, "ZULIP_LISTENER_FAILED"),
                    );
                }
            }
        }
    }
}

/** 为服务端长轮询窗口保留网络传输与响应解析余量。 */
function longPollTimeoutMs(registration: ZulipQueueRegistration): number | undefined {
    const seconds = registration.event_queue_longpoll_timeout_seconds;
    return typeof seconds === "number" && seconds > 0 ? seconds * 1_000 + 10_000 : undefined;
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, delayMs);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

function escapeFilename(filename: string): string {
    return filename.replace(/["\r\n]/g, "_");
}
