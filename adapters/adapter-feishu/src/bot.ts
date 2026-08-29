/**
 * 飞书 Bot 客户端
 * 基于飞书开放平台 API，使用 fetch 实现
 */
import { EventEmitter } from "node:events";
import {
    AESCipher,
    Domain,
    EventDispatcher,
    LoggerLevel,
    WSClient,
    type Logger,
} from "@larksuiteoapi/node-sdk";
import type { Next, RouterContext } from "onebots";
import {
    FeishuEndpoint,
    type FeishuConfig,
    type FeishuTokenResponse,
    type FeishuSendMessageRequest,
    type FeishuSendMessageResponse,
    type FeishuEvent,
    type FeishuUser,
    type FeishuChat,
    type FeishuWebhookBody,
    type FeishuAPIResponse,
    type FeishuUserAPIResponse,
    type FeishuChatAPIResponse,
    type FeishuChatMembersAPIResponse,
    type FeishuApiRequestOptions,
} from "./types.js";

export class FeishuBot extends EventEmitter {
    private config: FeishuConfig;
    private tenantAccessToken = "";
    private tokenExpireTime = 0;
    private me: FeishuUser | null = null;
    private wsClient?: WSClient;
    private eventDispatcher?: EventDispatcher;
    /** 当前使用的 API 端点 */
    readonly endpoint: string;

    constructor(config: FeishuConfig) {
        super();
        this.config = config;
        // 使用配置的端点，默认为飞书（国内版）
        this.endpoint = config.endpoint || FeishuEndpoint.FEISHU;
    }

    /** 初始化官方长连接；所有已注册事件仍进入统一 raw event 投影链路。 */
    configureLongConnection(logger: Logger): void {
        if (!this.config.long_connection || this.wsClient) return;
        const dispatcher = new EventDispatcher({
            verificationToken: this.config.verification_token,
            encryptKey: this.config.encrypt_key,
            logger,
        });
        const eventTypes = [
            "im.message.receive_v1",
            "im.message.recalled_v1",
            "im.message.message_read_v1",
            "im.chat.member.user.added_v1",
            "im.chat.member.user.deleted_v1",
            "im.chat.disbanded_v1",
            "im.chat.updated_v1",
            "application.bot.menu_v6",
        ];
        const handlers: Record<string, (data: Record<string, unknown>) => void> = {};
        for (const eventType of eventTypes) {
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
            onError: error => this.emit("error", error),
        });
    }

    private emitLongConnectionEvent(eventType: string, data: Record<string, unknown>): void {
        const body: FeishuWebhookBody = {
            schema: "2.0",
            header: {
                event_id: `${eventType}:${Date.now()}`,
                event_type: eventType,
                create_time: String(Date.now()),
                app_id: this.config.app_id,
            },
            event: data,
        };
        this.emit("event", body as FeishuEvent, body);
    }

    /**
     * 发送 HTTP 请求
     */
    private async request<T = unknown>(
        path: string,
        options: FeishuApiRequestOptions = {},
    ): Promise<T> {
        const { method = "GET", headers = {}, body, params, skipAuth = false } = options;

        // 构建 URL
        let url = `${this.endpoint}${path}`;
        if (params) {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                searchParams.append(key, String(value));
            }
            url += `?${searchParams.toString()}`;
        }

        // 构建请求头
        const requestHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            ...headers,
        };

        // 添加认证 token（除了获取 token 的请求）
        if (!skipAuth) {
            const token = await this.getTenantAccessToken();
            requestHeaders.Authorization = `Bearer ${token}`;
        }

        // 发送请求
        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
        });

        const text = await response.text();
        let result: unknown;
        try {
            result = text ? JSON.parse(text) : {};
        } catch (error) {
            throw new Error(`飞书 API ${method} ${path} 返回了无效 JSON`, { cause: error });
        }
        if (!response.ok) {
            const message =
                typeof result === "object" && result && "msg" in result
                    ? String(result.msg)
                    : response.statusText;
            throw new Error(`飞书 API ${method} ${path} 失败 (${response.status}): ${message}`);
        }
        return result as T;
    }

    /** 调用飞书开放平台 API，供能力清单声明的平台扩展动作使用。 */
    async callApi<T = unknown>(path: string, options: FeishuApiRequestOptions = {}): Promise<T> {
        if (!path.startsWith("/") || path.includes(".."))
            throw new Error("飞书 API path 必须为安全绝对路径");
        return this.request<T>(path, options);
    }

    /**
     * GET 请求
     */
    async get<T = unknown>(
        path: string,
        params?: Record<string, string | number | boolean>,
    ): Promise<{ data: T }> {
        const data = await this.callApi<T>(path, { params });
        return { data };
    }

    /**
     * POST 请求
     */
    async post<T = unknown>(
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
    async put<T = unknown>(
        path: string,
        body?: string | Record<string, unknown>,
    ): Promise<{ data: T }> {
        const data = await this.callApi<T>(path, { method: "PUT", body });
        return { data };
    }

    /**
     * DELETE 请求
     */
    async delete<T = unknown>(
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

        if (data.code !== 0) {
            throw new Error(`获取租户访问令牌失败: ${data.msg}`);
        }

        this.tenantAccessToken = data.tenant_access_token || "";
        this.tokenExpireTime = Date.now() + (data.expire - 60) * 1000; // 提前60秒刷新

        return this.tenantAccessToken;
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 获取访问令牌
            await this.getTenantAccessToken();

            // 获取 Bot 信息
            this.me = await this.getBotInfo();

            if (this.wsClient && this.eventDispatcher) {
                await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
            }
            this.emit("ready");
        } catch (error) {
            this.emit("error", error);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.wsClient?.close({ force: true });
        this.emit("stopped");
    }

    /**
     * 处理 Webhook 请求
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        let body = ctx.request.body as FeishuWebhookBody;
        if (body.encrypt) {
            if (!this.config.encrypt_key) {
                ctx.status = 400;
                ctx.body = { code: 1, msg: "收到加密事件但未配置 encrypt_key" };
                return;
            }
            try {
                body = JSON.parse(
                    new AESCipher(this.config.encrypt_key).decrypt(body.encrypt),
                ) as FeishuWebhookBody;
            } catch (error) {
                this.emit("error", error);
                ctx.status = 400;
                ctx.body = { code: 1, msg: "飞书事件解密失败" };
                return;
            }
        }

        // 验证事件（如果配置了 verification_token）
        const token = body.header?.token ?? body.token;
        if (this.config.verification_token && token !== this.config.verification_token) {
            ctx.status = 401;
            ctx.body = { code: 1, msg: "Invalid verification token" };
            return;
        }

        // 处理 URL 验证（飞书首次配置 webhook 时会发送验证请求）
        if (body.type === "url_verification") {
            ctx.body = { challenge: body.challenge };
            return;
        }

        // 处理事件
        const event = body as unknown as FeishuEvent;
        this.emit("event", event, body);

        ctx.body = { code: 0 };
        await next();
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): FeishuUser | null {
        return this.me;
    }

    /**
     * 获取 Bot 信息
     */
    async getBotInfo(): Promise<FeishuUser> {
        const response = await this.get<
            FeishuAPIResponse & {
                bot?: { open_id?: string; app_name?: string; avatar_url?: string };
            }
        >("/bot/v3/info");

        if (response.data.code !== 0 || !response.data.bot?.open_id) {
            throw new Error(`获取 Bot 信息失败: ${response.data.msg}`);
        }

        return {
            user_id: response.data.bot.open_id,
            open_id: response.data.bot.open_id,
            name: response.data.bot.app_name || "Feishu Bot",
            avatar_url: response.data.bot.avatar_url,
        };
    }

    /**
     * 发送消息
     */
    async sendMessage(
        receiveId: string,
        receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
        content: string | Record<string, unknown>,
        msgType: string = "text",
    ): Promise<FeishuSendMessageResponse> {
        const request: FeishuSendMessageRequest = {
            receive_id: receiveId,
            receive_id_type: receiveIdType,
            msg_type: msgType as FeishuSendMessageRequest["msg_type"],
            content:
                typeof content === "string"
                    ? JSON.stringify({ text: content })
                    : JSON.stringify(content),
        };

        const response = await this.post<FeishuSendMessageResponse>(
            "/im/v1/messages",
            request as unknown as Record<string, unknown>,
            {
                receive_id_type: receiveIdType,
            },
        );

        if (response.data.code !== 0) {
            throw new Error(`发送消息失败: ${response.data.msg}`);
        }

        return response.data;
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(
        userId: string,
        userIdType: "open_id" | "user_id" | "union_id" = "open_id",
    ): Promise<FeishuUser> {
        const response = await this.get<FeishuUserAPIResponse>(`/contact/v3/users/${userId}`, {
            user_id_type: userIdType,
        });

        if (response.data.code !== 0 || !response.data.data?.user) {
            throw new Error(`获取用户信息失败: ${response.data.msg}`);
        }

        return response.data.data.user;
    }

    /**
     * 获取群组信息
     */
    async getChatInfo(chatId: string): Promise<FeishuChat> {
        const response = await this.get<FeishuChatAPIResponse>(`/im/v1/chats/${chatId}`);

        if (response.data.code !== 0 || !response.data.data) {
            throw new Error(`获取群组信息失败: ${response.data.msg}`);
        }

        return response.data.data as FeishuChat;
    }

    /** 获取机器人可见的群列表。 */
    async getChatList(): Promise<FeishuChat[]> {
        const chats: FeishuChat[] = [];
        let pageToken: string | undefined;
        do {
            const response = await this.get<
                FeishuAPIResponse & {
                    data?: { items?: FeishuChat[]; page_token?: string; has_more?: boolean };
                }
            >("/im/v1/chats", {
                page_size: 100,
                ...(pageToken ? { page_token: pageToken } : {}),
            });
            if (response.data.code !== 0) throw new Error(`获取群列表失败: ${response.data.msg}`);
            chats.push(...(response.data.data?.items ?? []));
            pageToken = response.data.data?.has_more ? response.data.data.page_token : undefined;
        } while (pageToken);
        return chats;
    }

    /** 获取根部门下可见用户，供通用好友目录投影。 */
    async getUserList(): Promise<FeishuUser[]> {
        const users: FeishuUser[] = [];
        let pageToken: string | undefined;
        do {
            const response = await this.get<
                FeishuAPIResponse & {
                    data?: { items?: FeishuUser[]; page_token?: string; has_more?: boolean };
                }
            >("/contact/v3/users/find_by_department", {
                department_id: "0",
                user_id_type: "open_id",
                department_id_type: "department_id",
                page_size: 50,
                ...(pageToken ? { page_token: pageToken } : {}),
            });
            if (response.data.code !== 0)
                throw new Error(`获取通讯录用户失败: ${response.data.msg}`);
            users.push(...(response.data.data?.items ?? []));
            pageToken = response.data.data?.has_more ? response.data.data.page_token : undefined;
        } while (pageToken);
        return users;
    }

    /**
     * 获取群组成员列表
     */
    async getChatMembers(chatId: string): Promise<FeishuUser[]> {
        const response = await this.get<FeishuChatMembersAPIResponse>(
            `/im/v1/chats/${chatId}/members`,
        );

        if (response.data.code !== 0 || !response.data.data) {
            throw new Error(`获取群组成员列表失败: ${response.data.msg}`);
        }

        return response.data.data.items || [];
    }

    /**
     * 获取 HTTP 客户端实例（返回 this 以便链式调用）
     */
    getHttpClient(): FeishuBot {
        return this;
    }
}
