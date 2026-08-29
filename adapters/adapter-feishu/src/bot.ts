/**
 * 飞书 Bot 客户端
 * 基于飞书开放平台 API，使用 fetch 实现
 */
import { EventEmitter } from "node:events";
import {
    Domain,
    EventDispatcher,
    LoggerLevel,
    WSClient,
    type Logger,
} from "@larksuiteoapi/node-sdk";
import { isSafeAbsoluteApiPath, type Next, type RouterContext } from "onebots";
import { FeishuError } from "./errors.js";
import {
    FeishuEndpoint,
    type FeishuConfig,
    type FeishuTokenResponse,
    type FeishuSendMessageResponse,
    type FeishuEvent,
    type FeishuUser,
    type FeishuWebhookBody,
    type FeishuAPIResponse,
    type FeishuApiRequestOptions,
    type FeishuApiEnvelope,
} from "./types.js";
import {
    assertLongConnectionConfigured,
    FEISHU_LONG_CONNECTION_EVENT_TYPES,
    restoreLongConnectionEnvelope,
} from "./long-connection.js";
import { isFeishuApiEnvelope, isFeishuEvent } from "./guards.js";
import {
    buildFeishuApiUrl,
    normalizeFeishuEndpoint,
    serializeFeishuRequestBody,
} from "./http-input.js";
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

export interface FeishuBotEvents {
    ready: [];
    stopped: [];
    event: [event: FeishuEvent, rawEvent: FeishuWebhookBody];
    client_error: [error: FeishuError];
}

export class FeishuBot extends EventEmitter<FeishuBotEvents> {
    private config: FeishuConfig;
    private tenantAccessToken = "";
    private tokenExpireTime = 0;
    private tokenRequest?: Promise<string>;
    private me: FeishuUser | null = null;
    private wsClient?: WSClient;
    private eventDispatcher?: EventDispatcher;
    private sdkLogger?: Logger;
    private startPromise?: Promise<void>;
    private running = false;
    private generation = 0;
    /** 当前使用的 API 端点 */
    readonly endpoint: string;

    constructor(config: FeishuConfig) {
        super();
        this.config = { ...config, receive_mode: config.receive_mode ?? "long_connection" };
        // 使用配置的端点，默认为飞书（国内版）
        this.endpoint = normalizeFeishuEndpoint(config.endpoint || FeishuEndpoint.FEISHU);
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
        const handlers: Record<string, (data: Record<string, unknown>) => void> = {};
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

    private emitLongConnectionEvent(eventType: string, data: Record<string, unknown>): void {
        const body = restoreLongConnectionEnvelope(eventType, data, this.config.app_id);
        this.ingest(body, body);
    }

    /**
     * 发送 HTTP 请求
     */
    private async request<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        options: FeishuApiRequestOptions = {},
        retryAuth = true,
    ): Promise<T> {
        const { method = "GET", headers = {}, body, params, skipAuth = false } = options;

        const url = buildFeishuApiUrl(this.endpoint, path, params);

        // 构建请求头
        const requestHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            ...headers,
        };

        const requestBody = serializeFeishuRequestBody(body, `${method} ${path}`);

        // 添加认证 token（除了获取 token 的请求）
        const requestToken = skipAuth ? undefined : await this.getTenantAccessToken();
        if (requestToken) requestHeaders.Authorization = `Bearer ${requestToken}`;

        // 发送请求
        let response: Response;
        try {
            response = await fetch(url, {
                method,
                headers: requestHeaders,
                body: requestBody,
            });
        } catch (error) {
            throw FeishuError.wrap(error, "FEISHU_NETWORK_ERROR", `${method} ${path}`);
        }

        let text: string;
        try {
            text = await response.text();
        } catch (error) {
            throw FeishuError.wrap(error, "FEISHU_NETWORK_ERROR", `${method} ${path}`);
        }
        let result: unknown;
        try {
            result = text ? JSON.parse(text) : {};
        } catch (error) {
            throw new FeishuError(`飞书 API ${method} ${path} 返回了无效 JSON`, {
                code: "FEISHU_INVALID_RESPONSE",
                operation: `${method} ${path}`,
                status: response.status,
                cause: error,
            });
        }
        if (!isFeishuApiEnvelope(result)) {
            throw new FeishuError(`飞书 API ${method} ${path} 返回结构无效`, {
                code: "FEISHU_INVALID_RESPONSE",
                operation: `${method} ${path}`,
                status: response.status,
                details: result,
            });
        }
        if (result.code === 99991663 && requestToken && retryAuth) {
            // 只清除本次请求使用的旧令牌，不能覆盖并发请求已经刷新的新令牌。
            if (this.tenantAccessToken === requestToken) this.clearTenantAccessToken();
            return this.request<T>(path, options, false);
        }
        if (!response.ok) {
            throw new FeishuError(
                `飞书 API ${method} ${path} 失败 (${response.status}): ${result.msg}`,
                {
                    code: "FEISHU_HTTP_ERROR",
                    operation: `${method} ${path}`,
                    status: response.status,
                    platformCode: result.code,
                    details: result,
                },
            );
        }
        if (result.code !== 0)
            throw new FeishuError(`飞书 API ${method} ${path} 失败: ${result.msg}`, {
                code: "FEISHU_API_ERROR",
                operation: `${method} ${path}`,
                platformCode: result.code,
                details: result,
            });
        return result as unknown as T;
    }

    /** 调用飞书开放平台 API，供能力清单声明的平台扩展动作使用。 */
    async callApi<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        options: FeishuApiRequestOptions = {},
    ): Promise<T> {
        if (!isSafeAbsoluteApiPath(path))
            throw new FeishuError("飞书 API path 必须为安全绝对路径", {
                code: "FEISHU_UNSAFE_API_PATH",
                details: path,
            });
        return this.request<T>(path, options);
    }

    /**
     * GET 请求
     */
    async get<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }> {
        const data = await this.callApi<T>(path, { params });
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
    async getTenantAccessToken(): Promise<string> {
        if (this.tenantAccessToken && Date.now() < this.tokenExpireTime) {
            return this.tenantAccessToken;
        }

        if (this.tokenRequest) return this.tokenRequest;
        const request = this.loadTenantAccessToken();
        this.tokenRequest = request;
        try {
            return await request;
        } finally {
            if (this.tokenRequest === request) this.tokenRequest = undefined;
        }
    }

    /** 仅当调用方持有的确是当前令牌时才失效缓存，避免并发刷新相互覆盖。 */
    invalidateTenantAccessToken(token: string): void {
        if (this.tenantAccessToken === token) this.clearTenantAccessToken();
    }

    private async loadTenantAccessToken(): Promise<string> {
        const data = await this.request<FeishuTokenResponse>(
            "/auth/v3/tenant_access_token/internal",
            {
                method: "POST",
                body: {
                    app_id: this.config.app_id,
                    app_secret: this.config.app_secret,
                },
                skipAuth: true,
            },
        );

        if (!data.tenant_access_token)
            throw new FeishuError("获取租户访问令牌失败: 响应缺少 tenant_access_token", {
                code: "FEISHU_TOKEN_MISSING",
                details: data,
            });
        if (!Number.isFinite(data.expire) || data.expire <= 0)
            throw new FeishuError("获取租户访问令牌失败: expire 无效", {
                code: "FEISHU_TOKEN_EXPIRE_INVALID",
                details: data,
            });
        this.tenantAccessToken = data.tenant_access_token;
        this.tokenExpireTime = Date.now() + Math.max(data.expire - 60, 1) * 1000;

        return this.tenantAccessToken;
    }

    private clearTenantAccessToken(): void {
        this.tenantAccessToken = "";
        this.tokenExpireTime = 0;
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        if (this.running) return;
        if (this.startPromise) return this.startPromise;
        const generation = this.generation;
        const start = this.startInternal(generation);
        this.startPromise = start;
        try {
            await start;
        } finally {
            if (this.startPromise === start) this.startPromise = undefined;
        }
    }

    private async startInternal(generation: number): Promise<void> {
        let startingWs: WSClient | undefined;
        try {
            assertLongConnectionConfigured(this.config, this.sdkLogger);
            await this.getTenantAccessToken();
            if (generation !== this.generation) return;

            this.me = await this.getBotInfo();
            if (generation !== this.generation) return;

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
            if (generation !== this.generation) {
                startingWs?.close({ force: true });
                return;
            }
            this.running = true;
            this.safeEmit("ready");
        } catch (error) {
            if (startingWs && this.wsClient === startingWs) {
                startingWs.close({ force: true });
                this.wsClient = undefined;
                this.eventDispatcher = undefined;
            }
            this.running = false;
            throw FeishuError.wrap(error, "FEISHU_START_FAILED", "start");
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        const wasActive = this.running || Boolean(this.startPromise);
        this.generation += 1;
        this.running = false;
        this.startPromise = undefined;
        this.wsClient?.close({ force: true });
        this.wsClient = undefined;
        this.eventDispatcher = undefined;
        if (wasActive) this.safeEmit("stopped");
    }

    /**
     * 处理 Webhook 请求
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        const resolved = resolveFeishuWebhook(ctx.request.body, this.config);
        if ("response" in resolved) {
            if (resolved.error) this.safeEmit("client_error", resolved.error);
            if (resolved.response.status) ctx.status = resolved.response.status;
            ctx.body = resolved.response.body;
            return;
        }

        try {
            this.ingest(resolved.body, resolved.body);
        } catch (error) {
            this.safeEmit(
                "client_error",
                FeishuError.wrap(error, "FEISHU_WEBHOOK_INVALID", "webhook"),
            );
            ctx.status = 400;
            ctx.body = { code: 1, msg: "飞书事件结构无效" };
            return;
        }

        ctx.body = { code: 0 };
        await next();
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): FeishuUser | null {
        return this.me;
    }

    /** 将 Webhook、官方长连接或外部连接的事件交给同一校验入口。 */
    ingest(event: unknown, rawEvent?: FeishuWebhookBody): void {
        if (!isFeishuEvent(event)) {
            throw new FeishuError("飞书事件缺少有效的 2.0 header", {
                code: "FEISHU_INVALID_EVENT",
                details: event,
            });
        }
        this.safeEmit("event", event, rawEvent ?? event);
    }

    /**
     * 获取 Bot 信息
     */
    async getBotInfo(): Promise<FeishuUser> {
        return fetchFeishuBotInfo(this);
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
