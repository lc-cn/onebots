import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import {
    DWClient,
    EventAck,
    TOPIC_CARD,
    TOPIC_ROBOT,
    type DWClientDownStream,
} from "dingtalk-stream";
import type { Next, RouterContext } from "onebots";
import { DingTalkCallbackCrypto } from "./crypto.js";
import {
    getDingTalkDepartmentUsers,
    getDingTalkSceneGroupMembers,
    getDingTalkVisibleUsers,
} from "./directory-api.js";
import type {
    DingTalkApiRequestOptions,
    DingTalkConfig,
    DingTalkEvent,
    DingTalkRobotMessage,
    DingTalkSceneGroupMember,
    DingTalkSendResult,
    DingTalkTokenResponse,
    DingTalkUser,
    DingTalkUserGetResponse,
    DingTalkWebhookMessage,
    DingTalkWebhookResponse,
} from "./types.js";

const MODERN_API_BASE = "https://api.dingtalk.com";
const LEGACY_API_BASE = "https://oapi.dingtalk.com";

export interface DingTalkOutboundMessage {
    msgKey: string;
    msgParam: Record<string, unknown>;
    atUserIds?: string[];
    isAtAll?: boolean;
    webhook: DingTalkWebhookMessage;
}

export class DingTalkApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string | number,
        readonly requestId?: string,
    ) {
        super(message);
        this.name = "DingTalkApiError";
    }
}

/** 钉钉 API、Stream 与 HTTP 回调的底层客户端。 */
export class DingTalkBot extends EventEmitter {
    private accessToken = "";
    private tokenExpireTime = 0;
    private accessTokenPromise?: Promise<string>;
    private me: DingTalkUser | null = null;
    private streamClient?: DWClient;
    private callbackCrypto?: DingTalkCallbackCrypto;
    private readonly sessionWebhooks = new Map<string, { url: string; expiresAt: number }>();

    constructor(readonly config: DingTalkConfig) {
        super();
        if (config.encrypt_key) {
            if (!config.corp_id) throw new Error("钉钉加密回调必须配置 corp_id");
            this.callbackCrypto = new DingTalkCallbackCrypto(
                config.token || "",
                config.encrypt_key,
                config.corp_id,
            );
        }
    }

    get receiveMode(): "stream" | "webhook" {
        return this.config.receive_mode || "stream";
    }

    async start(): Promise<void> {
        if (this.receiveMode === "stream") await this.startStream();
        if (this.hasAppCredentials()) await this.getAccessToken();
        this.me ||= {
            userid: this.config.robot_code || this.config.app_key || this.config.account_id,
            name: "钉钉机器人",
        };
        this.emit("ready");
    }

    async stop(): Promise<void> {
        this.streamClient?.disconnect();
        this.streamClient = undefined;
        this.emit("stopped");
    }

    private async startStream(): Promise<void> {
        if (!this.config.app_key || !this.config.app_secret) {
            throw new Error("钉钉 Stream 模式必须配置 app_key 和 app_secret");
        }
        if (this.streamClient) return;
        const stream = new DWClient({
            clientId: this.config.app_key,
            clientSecret: this.config.app_secret,
            autoReconnect: true,
            keepAlive: true,
            debug: false,
        });
        stream.registerCallbackListener(TOPIC_ROBOT, message => {
            const data = parseObject(message.data, "钉钉 Stream 机器人消息");
            this.rememberRobot(data);
            this.emit("robot_message", data, message);
            stream.socketCallBackResponse(message.headers.messageId, { success: true });
        });
        stream.registerCallbackListener(TOPIC_CARD, message => {
            this.emit("native_event", streamEvent(message), message);
            stream.socketCallBackResponse(message.headers.messageId, { success: true });
        });
        stream.registerAllEventListener(message => {
            this.emit("event", streamEvent(message), message);
            return { status: EventAck.SUCCESS };
        });
        stream.on("error", error => this.emit("error", error));
        this.streamClient = stream;
        await stream.connect();
    }

    private rememberRobot(data: Record<string, unknown>): void {
        const message = data as DingTalkRobotMessage;
        if (message.chatbotUserId) {
            this.me = { userid: message.chatbotUserId, name: "钉钉机器人" };
        }
        if (message.conversationId && message.sessionWebhook) {
            this.sessionWebhooks.set(message.conversationId, {
                url: message.sessionWebhook,
                expiresAt: message.sessionWebhookExpiredTime || Date.now() + 60 * 60 * 1000,
            });
        }
    }

    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        try {
            const body = objectValue(ctx.request.body, "钉钉回调 body");
            const encrypted = stringValue(body.encrypt);
            if (encrypted) {
                if (!this.callbackCrypto) throw new Error("收到加密回调但未配置 encrypt_key");
                const timestamp = queryString(ctx.query.timestamp || ctx.query.timeStamp);
                const nonce = queryString(ctx.query.nonce);
                const signature = queryString(ctx.query.signature || ctx.query.msg_signature);
                const plain = this.callbackCrypto.decrypt(encrypted, signature, timestamp, nonce);
                const decoded = tryParseObject(plain);
                if (decoded) this.emit("event", webhookEvent(decoded), body);
                ctx.body = this.callbackCrypto.encryptResponse(decoded ? "success" : plain);
                return;
            }
            if (this.config.token && body.token !== this.config.token) {
                ctx.status = 401;
                ctx.body = { error: "Invalid token" };
                return;
            }
            if (looksLikeRobotMessage(body)) {
                this.rememberRobot(body);
                this.emit("robot_message", body, body);
            } else {
                this.emit("event", webhookEvent(body), body);
            }
            ctx.body = { success: true };
            await next();
        } catch (error) {
            this.emit("error", error);
            ctx.status = 400;
            ctx.body = { error: error instanceof Error ? error.message : "Invalid callback" };
        }
    }

    getCachedMe(): DingTalkUser | null {
        return this.me;
    }

    hasAppCredentials(): boolean {
        return Boolean(this.config.app_key && this.config.app_secret);
    }

    async getAccessToken(): Promise<string> {
        if (!this.hasAppCredentials())
            throw new Error("钉钉开放平台 API 需要 app_key 和 app_secret");
        if (this.accessToken && Date.now() < this.tokenExpireTime) return this.accessToken;
        const refresh = (this.accessTokenPromise ||= this.refreshAccessToken());
        try {
            return await refresh;
        } finally {
            if (this.accessTokenPromise === refresh) this.accessTokenPromise = undefined;
        }
    }

    private async refreshAccessToken(): Promise<string> {
        const data = await this.request<DingTalkTokenResponse>("/v1.0/oauth2/accessToken", {
            method: "POST",
            auth: "none",
            body: { appKey: this.config.app_key, appSecret: this.config.app_secret },
        });
        const token = data.accessToken || data.access_token;
        if (!token) throw new DingTalkApiError("获取钉钉访问令牌失败", 200, data.errcode);
        this.accessToken = token;
        this.tokenExpireTime =
            Date.now() + ((data.expireIn || data.expires_in || 7200) - 60) * 1000;
        return token;
    }

    async callApi<T = unknown>(path: string, options: DingTalkApiRequestOptions = {}): Promise<T> {
        if (!path.startsWith("/") || path.includes("..")) {
            throw new Error("钉钉 API path 必须为安全绝对路径");
        }
        return this.request<T>(path, options);
    }

    private async request<T>(path: string, options: DingTalkApiRequestOptions): Promise<T> {
        const auth = options.auth || (path.startsWith("/v1.0/") ? "modern" : "legacy");
        const url = new URL(`${auth === "legacy" ? LEGACY_API_BASE : MODERN_API_BASE}${path}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            url.searchParams.set(key, String(value));
        }
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...options.headers,
        };
        if (auth !== "none") {
            const token = await this.getAccessToken();
            if (auth === "modern") headers["x-acs-dingtalk-access-token"] = token;
            else url.searchParams.set("access_token", token);
        }
        const response = await fetch(url, {
            method: options.method || "GET",
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const text = await response.text();
        const data = parseResponse(text, path);
        const apiError = extractApiError(data);
        if (!response.ok || apiError) {
            throw new DingTalkApiError(
                apiError?.message || response.statusText || "钉钉 API 调用失败",
                response.status,
                apiError?.code,
                apiError?.requestId,
            );
        }
        return data as T;
    }

    async sendMessage(
        receiveId: string,
        scene: "private" | "group",
        message: DingTalkOutboundMessage,
    ): Promise<DingTalkSendResult | DingTalkWebhookResponse> {
        const session = this.sessionWebhooks.get(receiveId);
        if (session && session.expiresAt > Date.now()) {
            return this.postWebhook(session.url, message.webhook, true);
        }
        if (!this.hasAppCredentials()) {
            if (scene !== "group" || !this.config.webhook_url) {
                throw new Error("当前钉钉配置无法向该会话主动发送消息");
            }
            return this.postWebhook(this.signedWebhookUrl(), message.webhook, false);
        }
        const robotCode = this.config.robot_code || this.config.app_key;
        if (!robotCode) throw new Error("钉钉企业机器人必须配置 robot_code 或 app_key");
        const common = {
            robotCode,
            msgKey: message.msgKey,
            msgParam: JSON.stringify(message.msgParam),
        };
        if (scene === "private") {
            return this.callApi("/v1.0/robot/oToMessages/batchSend", {
                method: "POST",
                body: { ...common, userIds: [receiveId] },
            });
        }
        return this.callApi("/v1.0/robot/groupMessages/send", {
            method: "POST",
            body: {
                ...common,
                openConversationId: receiveId,
                ...(message.atUserIds?.length ? { atUserIds: message.atUserIds } : {}),
                ...(message.isAtAll ? { isAtAll: true } : {}),
            },
        });
    }

    private async postWebhook(
        url: string,
        message: DingTalkWebhookMessage,
        authenticated: boolean,
    ): Promise<DingTalkWebhookResponse> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (authenticated) {
            headers["x-acs-dingtalk-access-token"] = await this.getAccessToken();
        }
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(message),
        });
        const data = parseResponse(
            await response.text(),
            "session webhook",
        ) as DingTalkWebhookResponse;
        if (!response.ok || data.errcode) {
            throw new DingTalkApiError(
                data.errmsg || response.statusText,
                response.status,
                data.errcode,
            );
        }
        return data;
    }

    private signedWebhookUrl(): string {
        const raw = this.config.webhook_url;
        if (!raw) throw new Error("钉钉自定义机器人 webhook_url 未配置");
        if (!this.config.webhook_secret) return raw;
        const timestamp = Date.now().toString();
        const sign = createHmac("sha256", this.config.webhook_secret)
            .update(`${timestamp}\n${this.config.webhook_secret}`)
            .digest("base64");
        const url = new URL(raw);
        url.searchParams.set("timestamp", timestamp);
        url.searchParams.set("sign", sign);
        return url.toString();
    }

    async getUserInfo(userId: string): Promise<DingTalkUser> {
        const response = await this.callApi<DingTalkUserGetResponse>("/topapi/v2/user/get", {
            method: "POST",
            body: { userid: userId },
        });
        return response.result;
    }

    async getDepartmentUsers(departmentId = 1): Promise<DingTalkUser[]> {
        return getDingTalkDepartmentUsers(this, departmentId);
    }

    /** 获取应用可见的完整组织通讯录，并按用户 ID 去重。 */
    async getVisibleUsers(rootDepartmentId = 1): Promise<DingTalkUser[]> {
        return getDingTalkVisibleUsers(this, rootDepartmentId);
    }

    /** 获取场景群的完整成员目录；钉钉在此接口中提供群昵称。 */
    async getSceneGroupMembers(openConversationId: string): Promise<DingTalkSceneGroupMember[]> {
        return getDingTalkSceneGroupMembers(this, openConversationId);
    }
}

function streamEvent(message: DWClientDownStream): DingTalkEvent {
    const eventData = parseObject(message.data, "钉钉 Stream 事件");
    return {
        eventType: message.headers.eventType || message.headers.topic,
        eventId: message.headers.eventId || message.headers.messageId,
        eventTime: Number(message.headers.eventBornTime || message.headers.time) || Date.now(),
        eventCorpId: message.headers.eventCorpId,
        eventData,
        raw: { headers: { ...message.headers }, data: eventData, type: message.type },
    };
}

function webhookEvent(body: Record<string, unknown>): DingTalkEvent {
    return {
        eventType: String(body.EventType || body.eventType || body.type || "unknown"),
        eventId: String(body.eventId || body.id || `${Date.now()}`),
        eventTime: Number(body.eventTime || body.timestamp) || Date.now(),
        eventCorpId: stringValue(body.CorpId || body.corpId || body.eventCorpId),
        eventData: objectOrSelf(body.data, body),
        raw: body,
    };
}

function parseResponse(text: string, operation: string): unknown {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`钉钉 ${operation} 返回了无效 JSON`, { cause: error });
    }
}

function extractApiError(value: unknown) {
    if (!value || typeof value !== "object") return undefined;
    const data = value as Record<string, unknown>;
    const legacyCode = typeof data.errcode === "number" ? data.errcode : undefined;
    const modernCode = typeof data.code === "string" ? data.code : undefined;
    if ((!legacyCode || legacyCode === 0) && !modernCode) return undefined;
    return {
        code: modernCode || legacyCode,
        message: String(data.message || data.errmsg || "钉钉 API 调用失败"),
        requestId: stringValue(data.requestid || data.requestId),
    };
}

function parseObject(text: string, description: string): Record<string, unknown> {
    const value = parseResponse(text, description);
    return objectValue(value, description);
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
    try {
        const value: unknown = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : undefined;
    } catch {
        // URL 校验的 challenge 是普通字符串，并非 JSON。
        return undefined;
    }
}

function objectValue(value: unknown, description: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${description} 必须为对象`);
    }
    return value as Record<string, unknown>;
}

function objectOrSelf(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fallback;
}

function queryString(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return "";
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function looksLikeRobotMessage(value: Record<string, unknown>): boolean {
    return typeof value.msgId === "string" && typeof value.conversationId === "string";
}
