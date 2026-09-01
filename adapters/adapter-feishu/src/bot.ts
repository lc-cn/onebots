import { EventEmitter } from "node:events";
import {
    Domain,
    EventDispatcher,
    LoggerLevel,
    WSClient,
    type Logger,
} from "@larksuiteoapi/node-sdk";
import { emitAllAwaited, FailureCollector } from "onebots";
import { FeishuApiTransport } from "./api-transport.js";
import { FeishuError } from "./errors.js";
import {
    type FeishuConfig,
    type FeishuSendMessageResponse,
    type FeishuEvent,
    type FeishuUser,
    type FeishuWebhookBody,
    type FeishuAPIResponse,
    type FeishuApiRequestOptions,
    type FeishuApiEnvelope,
    type FeishuHttpContext,
    type FeishuHttpRequest,
    type FeishuHttpResponse,
} from "./types.js";
import {
    assertLongConnectionConfigured,
    FEISHU_LONG_CONNECTION_EVENT_TYPES,
    restoreLongConnectionEnvelope,
} from "./long-connection.js";
import { FeishuEventIngress } from "./event-ingress.js";
import {
    fetchFeishuBotInfo,
    fetchFeishuChat,
    fetchFeishuChatMember,
    fetchFeishuChatMembers,
    fetchFeishuChats,
    fetchFeishuUser,
    fetchFeishuUsers,
    sendFeishuMessage,
} from "./resources.js";
import { resolveFeishuWebhook } from "./webhook.js";
import {
    applyFeishuHttpResponse,
    FEISHU_JSON_HEADERS,
    feishuMethodNotAllowed,
    isFeishuFetchRequest,
    toFeishuFetchResponse,
} from "./http-bridge.js";

export interface FeishuBotEvents {
    ready: [];
    stopped: [];
    event: [event: FeishuEvent, rawEvent: FeishuWebhookBody];
    client_error: [error: FeishuError];
}

export class FeishuBot extends EventEmitter<FeishuBotEvents> {
    private config: FeishuConfig;
    private readonly transport: FeishuApiTransport;
    private me: FeishuUser | null = null;
    private wsClient?: WSClient;
    private eventDispatcher?: EventDispatcher;
    private sdkLogger?: Logger;
    private startPromise?: Promise<void>;
    private lifecycleAbort?: AbortController;
    private startSignal?: AbortSignal;
    private startSignalAbort?: () => void;
    private running = false;
    private generation = 0;
    private readonly eventIngress = new FeishuEventIngress();
    readonly endpoint: string;

    constructor(config: FeishuConfig) {
        super();
        this.config = { ...config, receive_mode: config.receive_mode ?? "long_connection" };
        this.transport = new FeishuApiTransport(config);
        this.endpoint = this.transport.endpoint;
    }

    /** 初始化官方长连接；所有已注册事件仍进入统一 raw event 投影链路。 */
    configureLongConnection(logger: Logger): void {
        this.sdkLogger = logger;
        if (this.config.receive_mode !== "long_connection" || this.wsClient) return;
        const dispatcher = new EventDispatcher({
            verificationToken: this.config.verification_token,
            encryptKey: this.config.encrypt_key,
            logger,
        });
        const handlers: Record<string, (data: Record<string, unknown>) => Promise<void>> = {};
        for (const eventType of FEISHU_LONG_CONNECTION_EVENT_TYPES) {
            handlers[eventType] = data => this.emitLongConnectionEvent(eventType, data);
        }
        dispatcher.register(handlers);
        this.eventDispatcher = dispatcher;
        this.wsClient = new WSClient({
            appId: this.config.app_id,
            appSecret: this.config.app_secret,
            domain: this.endpoint.includes("larksuite.com") ? Domain.Lark : Domain.Feishu,
            logger,
            loggerLevel: LoggerLevel.warn,
            autoReconnect: true,
            onError: error =>
                this.safeEmit("client_error", FeishuError.wrap(error, "FEISHU_WS_ERROR", "ws")),
        });
    }

    private async emitLongConnectionEvent(
        eventType: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        const body = restoreLongConnectionEnvelope(eventType, data, this.config.app_id);
        await this.ingest(body, body);
    }

    /** 调用飞书开放平台 API，供能力清单声明的平台扩展动作使用。 */
    async callApi<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        options: FeishuApiRequestOptions = {},
    ): Promise<T> {
        return this.transport.call<T>(path, options);
    }

    /**
     * GET 请求
     */
    async get<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        params?: Record<string, string | number | boolean>,
        signal?: AbortSignal,
    ): Promise<{ data: T }> {
        const data = await this.callApi<T>(path, { params, signal });
        return { data };
    }

    /**
     * POST 请求
     */
    async post<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        body?: string | Record<string, unknown>,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }> {
        const data = await this.callApi<T>(path, { method: "POST", body, params });
        return { data };
    }

    /**
     * PUT 请求
     */
    async put<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        body?: string | Record<string, unknown>,
    ): Promise<{ data: T }> {
        const data = await this.callApi<T>(path, { method: "PUT", body });
        return { data };
    }

    /**
     * DELETE 请求
     */
    async delete<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        body?: Record<string, unknown>,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }> {
        const data = await this.callApi<T>(path, { method: "DELETE", body, params });
        return { data };
    }

    /**
     * 获取租户访问令牌
     */
    async getTenantAccessToken(signal?: AbortSignal): Promise<string> {
        return this.transport.getTenantAccessToken(signal);
    }

    /** 仅当调用方持有的确是当前令牌时才失效缓存，避免并发刷新相互覆盖。 */
    invalidateTenantAccessToken(token: string): void {
        this.transport.invalidateTenantAccessToken(token);
    }

    /**
     * 启动 Bot
     */
    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.running) return;
        if (this.startPromise) return this.startPromise;
        this.bindStartSignal(signal);
        const generation = this.generation;
        const controller = new AbortController();
        this.lifecycleAbort = controller;
        const start = this.startInternal(generation, controller.signal);
        this.startPromise = start;
        try {
            await start;
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            if (controller.signal.aborted) {
                throw new FeishuError("飞书客户端启动已取消", {
                    code: "FEISHU_START_CANCELLED",
                    operation: "start",
                    cause: error,
                });
            }
            throw error;
        } finally {
            if (this.startPromise === start) this.startPromise = undefined;
            if (this.lifecycleAbort === controller && !this.running) {
                this.lifecycleAbort = undefined;
                this.unbindStartSignal();
            }
        }
    }

    private async startInternal(generation: number, signal: AbortSignal): Promise<void> {
        let startingWs: WSClient | undefined;
        try {
            assertLongConnectionConfigured(this.config, this.sdkLogger);
            await this.getTenantAccessToken(signal);
            this.assertLifecycle(generation, signal);

            const me = await this.getBotInfo(signal);
            this.assertLifecycle(generation, signal);
            this.me = me;

            if (
                this.config.receive_mode === "long_connection" &&
                !this.wsClient &&
                this.sdkLogger
            ) {
                this.configureLongConnection(this.sdkLogger);
            }
            if (this.wsClient && this.eventDispatcher) {
                startingWs = this.wsClient;
                await startingWs.start({ eventDispatcher: this.eventDispatcher });
            }
            this.assertLifecycle(generation, signal);
            this.running = true;
            await emitAllAwaited(this, "ready");
            this.assertLifecycle(generation, signal);
        } catch (error) {
            if (generation === this.generation) {
                const failures = new FailureCollector();
                failures.add(error);
                if (startingWs && this.wsClient === startingWs) {
                    this.wsClient = undefined;
                    this.eventDispatcher = undefined;
                    await failures.capture(() => startingWs?.close({ force: true }));
                }
                this.running = false;
                try {
                    failures.throwIfAny("飞书客户端启动回滚期间发生多个错误");
                } catch (failure) {
                    throw FeishuError.wrap(failure, "FEISHU_START_FAILED", "start");
                }
            }
            throw FeishuError.wrap(error, "FEISHU_START_FAILED", "start");
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        const wasActive = this.running || Boolean(this.startPromise);
        this.unbindStartSignal();
        this.generation += 1;
        this.running = false;
        this.startPromise = undefined;
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        const wsClient = this.wsClient;
        this.wsClient = undefined;
        this.eventDispatcher = undefined;
        const failures = new FailureCollector();
        if (wsClient) await failures.capture(() => wsClient.close({ force: true }));
        if (wasActive) await failures.capture(() => emitAllAwaited(this, "stopped"));
        try {
            failures.throwIfAny("飞书客户端停止期间发生多个错误");
        } catch (error) {
            throw FeishuError.wrap(error, "FEISHU_STOP_FAILED", "stop");
        }
    }

    private bindStartSignal(signal?: AbortSignal): void {
        this.unbindStartSignal();
        if (!signal) return;
        const abort = () => {
            void this.stop().catch(error =>
                this.safeEmit(
                    "client_error",
                    FeishuError.wrap(error, "FEISHU_STOP_FAILED", "stop"),
                ),
            );
        };
        this.startSignal = signal;
        this.startSignalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindStartSignal(): void {
        if (this.startSignal && this.startSignalAbort) {
            this.startSignal.removeEventListener("abort", this.startSignalAbort);
        }
        this.startSignal = undefined;
        this.startSignalAbort = undefined;
    }

    private assertLifecycle(generation: number, signal: AbortSignal): void {
        signal.throwIfAborted();
        if (generation !== this.generation) {
            throw new FeishuError("飞书客户端启动已取消", {
                code: "FEISHU_START_CANCELLED",
                operation: "start",
            });
        }
    }

    /** 解密、认证、投递和响应映射共用一个宿主无关的 HTTP 边界。 */
    async ingestHttp(request: FeishuHttpRequest): Promise<FeishuHttpResponse> {
        if (request.method.toUpperCase() !== "POST") return feishuMethodNotAllowed();
        const resolved = resolveFeishuWebhook(request.body, this.config);
        if ("response" in resolved) {
            if (resolved.error) this.safeEmit("client_error", resolved.error);
            return {
                status: resolved.response.status ?? 200,
                headers: FEISHU_JSON_HEADERS,
                body: resolved.response.body,
            };
        }

        try {
            const event = await this.ingest(resolved.body, resolved.body);
            return {
                status: 200,
                headers: FEISHU_JSON_HEADERS,
                body: { code: 0 },
                event,
            };
        } catch (error) {
            const wrapped = FeishuError.wrap(error, "FEISHU_WEBHOOK_FAILED", "webhook");
            this.safeEmit("client_error", wrapped);
            const invalidEvent = wrapped.code === "FEISHU_INVALID_EVENT";
            return {
                status: invalidEvent ? 400 : 500,
                headers: FEISHU_JSON_HEADERS,
                body: {
                    code: 1,
                    msg: invalidEvent ? "飞书事件结构无效" : "飞书事件处理失败",
                },
            };
        }
    }

    /** Fetch / WinterCG 与 Koa 风格 Host 都可直接复用同一 Webhook 管线。 */
    async acceptHttp(request: Request): Promise<Response>;
    async acceptHttp(context: FeishuHttpContext): Promise<void>;
    async acceptHttp(input: Request | FeishuHttpContext): Promise<Response | void> {
        if (isFeishuFetchRequest(input)) {
            let body: unknown;
            if (input.method.toUpperCase() === "POST") {
                try {
                    body = await input.json();
                } catch (error) {
                    const wrapped = FeishuError.wrap(
                        error,
                        "FEISHU_WEBHOOK_INVALID_JSON",
                        "webhook",
                    );
                    this.safeEmit("client_error", wrapped);
                }
            }
            return toFeishuFetchResponse(await this.ingestHttp({ method: input.method, body }));
        }
        applyFeishuHttpResponse(
            input,
            await this.ingestHttp({ method: input.method, body: input.request.body }),
        );
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): FeishuUser | null {
        return this.me;
    }

    /** 返回应用身份回退值；仅在尚未获取机器人 open_id 时使用。 */
    getAppId(): string {
        return this.config.app_id;
    }

    /** 将 Webhook、官方长连接或外部连接的事件交给同一校验入口。 */
    async ingest(event: unknown, rawEvent?: FeishuWebhookBody): Promise<FeishuEvent | undefined> {
        return this.eventIngress.ingest(event, parsed =>
            emitAllAwaited(this, "event", parsed, rawEvent ?? { ...parsed }),
        );
    }

    /**
     * 获取 Bot 信息
     */
    async getBotInfo(signal?: AbortSignal): Promise<FeishuUser> {
        return fetchFeishuBotInfo(this, signal);
    }

    /**
     * 发送消息
     */
    async sendMessage(
        receiveId: string,
        receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
        content: string | Record<string, unknown>,
        msgType: Parameters<typeof sendFeishuMessage>[4] = "text",
    ): Promise<FeishuSendMessageResponse> {
        return sendFeishuMessage(this, receiveId, receiveIdType, content, msgType);
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(
        userId: string,
        userIdType: "open_id" | "user_id" | "union_id" = "open_id",
    ): Promise<FeishuUser> {
        return fetchFeishuUser(this, userId, userIdType);
    }

    /**
     * 获取群组信息
     */
    async getChatInfo(chatId: string): Promise<import("./types.js").FeishuChat> {
        return fetchFeishuChat(this, chatId);
    }

    /** 获取机器人可见的群列表。 */
    async getChatList(): Promise<import("./types.js").FeishuChat[]> {
        return fetchFeishuChats(this);
    }

    /** 获取根部门下可见用户，供通用好友目录投影。 */
    async getUserList(): Promise<FeishuUser[]> {
        return fetchFeishuUsers(this);
    }

    /**
     * 获取群组成员列表
     */
    async getChatMembers(chatId: string): Promise<FeishuUser[]> {
        return fetchFeishuChatMembers(this, chatId);
    }

    /** 只返回目标群中真实存在的成员。 */
    async getChatMember(chatId: string, userId: string): Promise<FeishuUser> {
        return fetchFeishuChatMember(this, chatId, userId);
    }

    private safeEmit<K extends keyof FeishuBotEvents>(name: K, ...args: FeishuBotEvents[K]): void {
        for (const listener of this.rawListeners(String(name))) {
            try {
                Reflect.apply(listener, this, args);
            } catch (error) {
                if (name !== "client_error")
                    this.safeEmit(
                        "client_error",
                        FeishuError.wrap(error, "FEISHU_LISTENER_FAILED", String(name)),
                    );
            }
        }
    }
}
