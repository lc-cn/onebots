import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { emitAwaited, isSafeAbsoluteApiPath, KeyedSingleFlight, RefreshableValue } from "onebots";
import { assertWechatConfig } from "./config.js";
import { WechatApiError } from "./errors.js";
import type {
    WechatApiCallOptions,
    WechatClientEvents,
    WechatConfig,
    WechatIncomingMessage,
    WechatIngressOptions,
    WechatNamedEvent,
    WechatOutboundMessage,
    WechatTag,
    WechatTemplateMessage,
    WechatUser,
    WechatUserList,
} from "./types.js";

const DEFAULT_API_BASE = "https://api.weixin.qq.com";
const TOKEN_REFRESH_MARGIN = 300_000;
const INVALID_TOKEN_CODES = new Set([40001, 40014, 42001]);
const DEFAULT_DEDUPLICATION_LIMIT = 10_000;

interface PendingReply {
    resolve(message: WechatOutboundMessage | undefined): void;
    timer: ReturnType<typeof setTimeout>;
}

/** 微信公众号 API 客户端与统一事件入口。 */
export class WechatClient extends EventEmitter<WechatClientEvents> {
    readonly apiBaseUrl: string;
    private readonly tokens = new RefreshableValue<string>(TOKEN_REFRESH_MARGIN);
    private readonly pendingReplies = new Map<string, PendingReply>();
    private readonly processedEvents = new Set<string>();
    private readonly eventFlights = new KeyedSingleFlight<
        string,
        WechatOutboundMessage | undefined
    >();

    constructor(
        readonly config: WechatConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        super();
        assertWechatConfig(config);
        this.apiBaseUrl = requireHttpsBase(config.api_base_url || DEFAULT_API_BASE);
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receive_mode || "webhook";
    }

    async start(): Promise<void> {
        await this.getAccessToken();
        this.emit("ready");
    }

    stop(): void {
        this.tokens.clear();
        this.eventFlights.clear();
        for (const pending of this.pendingReplies.values()) {
            clearTimeout(pending.timer);
            pending.resolve(undefined);
        }
        this.pendingReplies.clear();
        this.emit("stop");
    }

    /** 获取并缓存 access_token；并发刷新只发起一个请求。 */
    async getAccessToken(force = false): Promise<string> {
        return this.tokens.get(() => this.fetchAccessToken(force), force);
    }

    /** 调用任意经过路径约束的公众号 API；token 失效时仅自动刷新并重试一次。 */
    async call<T = unknown>(options: WechatApiCallOptions): Promise<T> {
        return this.performCall<T>(options, true);
    }

    async sendCustomMessage(openid: string, message: WechatOutboundMessage): Promise<string> {
        await this.call({
            method: "POST",
            path: "/cgi-bin/message/custom/send",
            body: { ...message, touser: openid },
        });
        return `custom:${randomUUID()}`;
    }

    async sendTemplate(message: WechatTemplateMessage): Promise<string> {
        const result = await this.call<{ msgid?: number }>({
            method: "POST",
            path: "/cgi-bin/message/template/send",
            body: message,
        });
        return result.msgid == null ? `template:${randomUUID()}` : String(result.msgid);
    }

    sendTyping(openid: string, typing = true): Promise<unknown> {
        return this.call({
            method: "POST",
            path: "/cgi-bin/message/custom/typing",
            body: { touser: openid, command: typing ? "Typing" : "CancelTyping" },
        });
    }

    getUserInfo(openid: string, lang = "zh_CN"): Promise<WechatUser> {
        return this.call({ path: "/cgi-bin/user/info", query: { openid, lang } });
    }

    getUserList(nextOpenid?: string): Promise<WechatUserList> {
        return this.call({
            path: "/cgi-bin/user/get",
            query: { next_openid: nextOpenid },
        });
    }

    async batchGetUserInfo(openids: string[]): Promise<WechatUser[]> {
        const result: WechatUser[] = [];
        for (let index = 0; index < openids.length; index += 100) {
            const page = await this.call<{ user_info_list?: WechatUser[] }>({
                method: "POST",
                path: "/cgi-bin/user/info/batchget",
                body: {
                    user_list: openids
                        .slice(index, index + 100)
                        .map(openid => ({ openid, lang: "zh_CN" })),
                },
            });
            result.push(...(page.user_info_list || []));
        }
        return result;
    }

    updateUserRemark(openid: string, remark: string): Promise<unknown> {
        return this.call({
            method: "POST",
            path: "/cgi-bin/user/info/updateremark",
            body: { openid, remark },
        });
    }

    async getTags(): Promise<WechatTag[]> {
        const result = await this.call<{ tags?: WechatTag[] }>({ path: "/cgi-bin/tags/get" });
        return result.tags || [];
    }

    /** 注册一次入站事件，并在可选窗口内接收按消息 ID 关联的被动回复。 */
    async ingest(
        message: WechatIncomingMessage,
        options: WechatIngressOptions = {},
    ): Promise<WechatOutboundMessage | undefined> {
        validateIncomingMessage(message);
        const eventId = wechatEventId(message);
        if (this.isDuplicate(eventId)) return undefined;
        return this.eventFlights.run(eventId, () =>
            this.deliverIncoming(message, eventId, options),
        );
    }

    private async deliverIncoming(
        message: WechatIncomingMessage,
        eventId: string,
        options: WechatIngressOptions,
    ): Promise<WechatOutboundMessage | undefined> {
        if (this.isDuplicate(eventId)) return undefined;
        const timeout = Math.max(0, Math.min(4_500, options.passiveReplyTimeoutMs || 0));
        let waiter: Promise<WechatOutboundMessage | undefined> | undefined;
        if (timeout > 0) {
            waiter = new Promise(resolve => {
                const timer = setTimeout(() => {
                    this.pendingReplies.delete(eventId);
                    resolve(undefined);
                }, timeout);
                this.pendingReplies.set(eventId, { resolve, timer });
            });
        }
        try {
            await emitAwaited(this, "raw_event", message);
            await emitAwaited(this, message.MsgType === "event" ? "event" : "message", message);
            if (message.MsgType === "event" && message.Event) {
                await emitAwaited(this, `event.${message.Event.toLowerCase()}`, message);
            }
            const reply = await waiter;
            this.markProcessed(eventId);
            return reply;
        } catch (error) {
            this.cancelPendingReply(eventId);
            throw error;
        }
    }

    /** 按微信 Event 精确订阅，并返回取消订阅函数。 */
    onEvent<K extends string>(
        name: K,
        listener: (event: WechatNamedEvent<K>) => unknown,
    ): () => void {
        const eventName = `event.${name.toLowerCase()}` as const;
        const wrapped = async (event: WechatIncomingMessage): Promise<void> => {
            await listener(event as WechatNamedEvent<K>);
        };
        this.on(eventName, wrapped);
        return () => this.off(eventName, wrapped);
    }

    submitPassiveReply(eventId: string, message: WechatOutboundMessage): boolean {
        const pending = this.pendingReplies.get(eventId);
        if (!pending) return false;
        this.pendingReplies.delete(eventId);
        clearTimeout(pending.timer);
        pending.resolve(message);
        return true;
    }

    hasPendingPassiveReply(eventId: string): boolean {
        return this.pendingReplies.has(eventId);
    }

    private cancelPendingReply(eventId: string): void {
        const pending = this.pendingReplies.get(eventId);
        if (!pending) return;
        this.pendingReplies.delete(eventId);
        clearTimeout(pending.timer);
        pending.resolve(undefined);
    }

    private isDuplicate(eventId: string): boolean {
        return this.config.deduplicate_webhooks !== false && this.processedEvents.has(eventId);
    }

    private markProcessed(eventId: string): void {
        if (this.config.deduplicate_webhooks === false) return;
        this.processedEvents.add(eventId);
        const limit = this.config.webhook_deduplication_limit || DEFAULT_DEDUPLICATION_LIMIT;
        while (this.processedEvents.size > limit) {
            const oldest = this.processedEvents.values().next().value;
            if (typeof oldest !== "string") break;
            this.processedEvents.delete(oldest);
        }
    }

    async uploadTemporaryMedia(
        type: "image" | "voice" | "video" | "thumb",
        data: Blob,
        filename = "upload",
    ): Promise<{ type: string; media_id: string; created_at: number }> {
        const form = new FormData();
        form.set("media", data, filename);
        const result = await this.call<{
            type?: unknown;
            media_id?: unknown;
            created_at?: unknown;
        }>({
            method: "POST",
            path: "/cgi-bin/media/upload",
            query: { type },
            body: form,
        });
        if (typeof result.media_id !== "string" || !result.media_id) {
            throw new WechatApiError("微信临时素材响应缺少 media_id", {
                code: "WECHAT_INVALID_MEDIA_RESPONSE",
                details: result,
            });
        }
        return {
            type: typeof result.type === "string" ? result.type : type,
            media_id: result.media_id,
            created_at: typeof result.created_at === "number" ? result.created_at : 0,
        };
    }

    private async fetchAccessToken(force: boolean): Promise<{ value: string; ttlMs: number }> {
        const data = await this.performCall<{ access_token?: string; expires_in?: number }>(
            {
                method: "POST",
                path: "/cgi-bin/stable_token",
                token: false,
                body: {
                    grant_type: "client_credential",
                    appid: this.config.app_id,
                    secret: this.config.app_secret,
                    force_refresh: force,
                },
            },
            false,
        );
        if (!data.access_token || !data.expires_in) {
            throw new WechatApiError("微信 Access Token 响应缺少必要字段", {
                code: "WECHAT_INVALID_TOKEN_RESPONSE",
                details: data,
            });
        }
        this.emit("token_refreshed", data.expires_in);
        return { value: data.access_token, ttlMs: data.expires_in * 1000 };
    }

    private async performCall<T>(options: WechatApiCallOptions, retryToken: boolean): Promise<T> {
        const url = this.resolvePath(options.path, options.query);
        const requestToken = options.token === false ? undefined : await this.getAccessToken();
        if (requestToken) url.searchParams.set("access_token", requestToken);
        const headers = new Headers();
        let body: BodyInit | undefined;
        if (options.body instanceof FormData || typeof options.body === "string") {
            body = options.body;
        } else if (options.body !== undefined) {
            headers.set("Content-Type", "application/json; charset=utf-8");
            body = JSON.stringify(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, {
                method: options.method || (body ? "POST" : "GET"),
                headers,
                body,
                signal: options.signal,
            });
        } catch (error) {
            throw new WechatApiError("微信公众号 API 网络请求失败", {
                code: "WECHAT_NETWORK_ERROR",
                path: options.path,
                cause: error,
            });
        }
        if (options.responseType === "buffer" && !isJson(response)) {
            if (!response.ok) return this.httpError(response, options.path);
            return Buffer.from(await response.arrayBuffer()) as T;
        }
        const payload = await parseJson(response, options.path);
        const errorCode = apiErrorCode(payload);
        if (retryToken && INVALID_TOKEN_CODES.has(errorCode)) {
            if (requestToken && this.tokens.invalidate(requestToken)) {
                await this.getAccessToken(true);
            }
            return this.performCall<T>(options, false);
        }
        if (!response.ok || errorCode !== 0) throw apiError(response, payload, options.path);
        return payload as T;
    }

    private resolvePath(
        path: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
    ): URL {
        if (!isSafeAbsoluteApiPath(path)) {
            throw new WechatApiError("微信公众号 API path 必须是安全的绝对路径", {
                code: "WECHAT_INVALID_API_PATH",
                path,
            });
        }
        const url = new URL(`${this.apiBaseUrl}${path}`);
        for (const [key, value] of Object.entries(query || {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return url;
    }

    private httpError(response: Response, path: string): never {
        throw new WechatApiError(`微信公众号 API 返回 HTTP ${response.status}`, {
            code: "WECHAT_HTTP_ERROR",
            status: response.status,
            path,
        });
    }
}

function validateIncomingMessage(message: WechatIncomingMessage): void {
    if (
        typeof message.ToUserName !== "string" ||
        !message.ToUserName ||
        typeof message.FromUserName !== "string" ||
        !message.FromUserName ||
        !Number.isFinite(message.CreateTime) ||
        message.CreateTime <= 0 ||
        typeof message.MsgType !== "string" ||
        !message.MsgType
    ) {
        throw new WechatApiError("微信公众号事件缺少稳定的收发方、时间或消息类型", {
            code: "WECHAT_INVALID_EVENT",
        });
    }
    if (message.MsgType !== "event" && (!message.MsgId || typeof message.MsgId !== "string")) {
        throw new WechatApiError("微信公众号消息缺少 MsgId", {
            code: "WECHAT_INVALID_EVENT",
        });
    }
}

export function wechatEventId(message: WechatIncomingMessage): string {
    if (message.MsgId || message.MsgID) return message.MsgId || message.MsgID!;
    const identity = [
        message.FromUserName,
        message.CreateTime,
        message.Event || message.MsgType,
        message.EventKey,
    ]
        .filter(value => value !== undefined && value !== "")
        .join(":");
    const digest = createHash("sha256")
        .update(message.RawXml || JSON.stringify(messageWithoutEncryptedXml(message)))
        .digest("hex");
    return identity ? `${identity}:${digest.slice(0, 16)}` : digest;
}

function messageWithoutEncryptedXml(message: WechatIncomingMessage): Record<string, unknown> {
    return Object.fromEntries(Object.entries(message).filter(([key]) => key !== "EncryptedXml"));
}

async function parseJson(response: Response, path: string): Promise<unknown> {
    try {
        return await response.json();
    } catch (error) {
        throw new WechatApiError("微信公众号 API 返回了无效 JSON", {
            code: "WECHAT_INVALID_RESPONSE",
            status: response.status,
            path,
            cause: error,
        });
    }
}

function apiErrorCode(payload: unknown): number {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
    const value = (payload as Record<string, unknown>).errcode;
    return typeof value === "number" ? value : 0;
}

function apiError(response: Response, payload: unknown, path: string): WechatApiError {
    const record = payload as Record<string, unknown>;
    const code = typeof record.errcode === "number" ? record.errcode : response.status;
    const message = typeof record.errmsg === "string" ? record.errmsg : response.statusText;
    return new WechatApiError(message || `微信公众号 API 调用失败: ${code}`, {
        code: `WECHAT_${code}`,
        status: response.status,
        path,
        details: payload,
    });
}

function isJson(response: Response): boolean {
    return (response.headers.get("content-type") || "").includes("json");
}

function requireHttpsBase(value: string): string {
    if (!URL.canParse(value)) {
        throw new WechatApiError("api_base_url 必须是有效 HTTPS URL", {
            code: "WECHAT_INVALID_API_BASE_URL",
        });
    }
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new WechatApiError("api_base_url 必须是无凭据、查询参数或片段的 HTTPS URL", {
            code: "WECHAT_INVALID_API_BASE_URL",
        });
    }
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}
