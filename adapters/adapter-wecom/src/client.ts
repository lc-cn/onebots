import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { WeComApiError } from "./errors.js";
import type {
    WeComAgent,
    WeComAppChat,
    WeComCallOptions,
    WeComConfig,
    WeComDepartmentMembersResponse,
    WeComEvent,
    WeComSendMessageResponse,
    WeComTokenResponse,
    WeComUser,
} from "./types.js";

const DEFAULT_API_BASE = "https://qyapi.weixin.qq.com";
const TOKEN_MARGIN_MS = 120_000;
const INVALID_TOKEN_CODES = new Set([40014, 42001, 42007, 42009]);

/** 企业微信自建应用 API 客户端与统一事件入口。 */
export class WeComClient extends EventEmitter {
    readonly apiBaseUrl: string;
    private accessToken = "";
    private tokenExpiresAt = 0;
    private tokenRequest?: Promise<string>;
    private agent?: WeComAgent;

    constructor(
        readonly config: WeComConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        super();
        if (!/^\d+$/u.test(config.agent_id)) {
            throw new WeComApiError("agent_id 必须是数字字符串", {
                code: "WECOM_INVALID_AGENT_ID",
            });
        }
        this.apiBaseUrl = requireHttpsBase(config.api_base_url || DEFAULT_API_BASE);
    }

    async start(): Promise<WeComAgent> {
        await this.getAccessToken();
        this.agent = await this.getAgent();
        this.emit("ready", this.agent);
        return this.agent;
    }

    stop(): void {
        this.accessToken = "";
        this.tokenExpiresAt = 0;
        this.tokenRequest = undefined;
        this.emit("stop");
    }

    getCachedAgent(): WeComAgent | undefined {
        return this.agent;
    }

    async getAccessToken(force = false): Promise<string> {
        if (!force && this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_MARGIN_MS)
            return this.accessToken;
        if (this.tokenRequest) return this.tokenRequest;
        const request = this.fetchToken();
        this.tokenRequest = request;
        try {
            return await request;
        } finally {
            if (this.tokenRequest === request) this.tokenRequest = undefined;
        }
    }

    call<T = unknown>(options: WeComCallOptions): Promise<T> {
        return this.performCall<T>(options, true);
    }

    getAgent(): Promise<WeComAgent> {
        return this.call({ path: "/cgi-bin/agent/get", query: { agentid: this.config.agent_id } });
    }

    async sendApplicationMessage(message: Record<string, unknown>): Promise<string> {
        if (typeof message.msgtype !== "string" || !message.msgtype) {
            throw new WeComApiError("企业微信原生消息缺少 msgtype", {
                code: "WECOM_INVALID_MESSAGE",
            });
        }
        const result = await this.call<WeComSendMessageResponse>({
            method: "POST",
            path: "/cgi-bin/message/send",
            body: { ...message, agentid: Number(this.config.agent_id) },
        });
        return result.msgid || `application:${result.response_code || randomUUID()}`;
    }

    async sendAppChatMessage(chatid: string, message: Record<string, unknown>): Promise<string> {
        const result = await this.call<{ msgid?: string }>({
            method: "POST",
            path: "/cgi-bin/appchat/send",
            body: { ...message, chatid },
        });
        return result.msgid || `appchat:${randomUUID()}`;
    }

    async recallMessage(msgid: string): Promise<unknown> {
        if (msgid.startsWith("application:") || msgid.startsWith("appchat:")) {
            throw new WeComApiError("该消息没有企业微信服务端 msgid，无法撤回", {
                code: "WECOM_MESSAGE_NOT_RECALLABLE",
            });
        }
        return this.call({ method: "POST", path: "/cgi-bin/message/recall", body: { msgid } });
    }

    getUserInfo(userid: string): Promise<WeComUser> {
        return this.call({ path: "/cgi-bin/user/get", query: { userid } });
    }

    async listDepartmentUsers(departmentId: number, fetchChild = false): Promise<WeComUser[]> {
        const result = await this.call<WeComDepartmentMembersResponse>({
            path: "/cgi-bin/user/list",
            query: { department_id: departmentId, fetch_child: fetchChild ? 1 : 0 },
        });
        return result.userlist || [];
    }

    async getAppChat(chatid: string): Promise<WeComAppChat> {
        const result = await this.call<{ chat_info: WeComAppChat }>({
            path: "/cgi-bin/appchat/get",
            query: { chatid },
        });
        return result.chat_info;
    }

    async uploadTemporaryMedia(
        type: "image" | "voice" | "video" | "file",
        data: Blob,
        filename = "upload",
    ): Promise<{ media_id: string; created_at: string }> {
        const form = new FormData();
        form.set("media", data, filename);
        const result = await this.call<{ media_id?: unknown; created_at?: unknown }>({
            method: "POST",
            path: "/cgi-bin/media/upload",
            query: { type },
            body: form,
        });
        if (typeof result.media_id !== "string" || !result.media_id) {
            throw new WeComApiError("企业微信临时素材响应缺少 media_id", {
                code: "WECOM_INVALID_MEDIA_RESPONSE",
                details: result,
            });
        }
        return {
            media_id: result.media_id,
            created_at:
                typeof result.created_at === "string" || typeof result.created_at === "number"
                    ? String(result.created_at)
                    : "",
        };
    }

    ingest(event: WeComEvent): void {
        validateEvent(event);
        this.emit("raw_event", event);
        const isEvent = event.MsgType === "event";
        this.emit(isEvent ? "event" : "message", event);
        const name = event.Event;
        if (name) this.emit(`event.${name.toLowerCase()}`, event);
    }

    private async fetchToken(): Promise<string> {
        const result = await this.performCall<WeComTokenResponse>(
            {
                path: "/cgi-bin/gettoken",
                token: false,
                query: { corpid: this.config.corp_id, corpsecret: this.config.corp_secret },
            },
            false,
        );
        if (!result.access_token || !result.expires_in) {
            throw new WeComApiError("企业微信 access_token 响应缺少必要字段", {
                code: "WECOM_INVALID_TOKEN_RESPONSE",
                details: result,
            });
        }
        this.accessToken = result.access_token;
        this.tokenExpiresAt = Date.now() + result.expires_in * 1000;
        return result.access_token;
    }

    private async performCall<T>(options: WeComCallOptions, retryToken: boolean): Promise<T> {
        const url = this.resolvePath(options.path, options.query);
        if (options.token !== false)
            url.searchParams.set("access_token", await this.getAccessToken());
        const headers = new Headers();
        let body: BodyInit | undefined;
        if (options.body instanceof FormData || typeof options.body === "string")
            body = options.body;
        else if (options.body !== undefined) {
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
            throw new WeComApiError("企业微信 API 网络请求失败", {
                code: "WECOM_NETWORK_ERROR",
                path: options.path,
                cause: error,
            });
        }
        if (options.response_type === "buffer" && !isJson(response)) {
            if (!response.ok) return this.httpError(response, options.path);
            return Buffer.from(await response.arrayBuffer()) as T;
        }
        const payload = await parseJson(response, options.path);
        const errorCode = apiErrorCode(payload);
        if (retryToken && INVALID_TOKEN_CODES.has(errorCode)) {
            this.accessToken = "";
            await this.getAccessToken(true);
            return this.performCall<T>(options, false);
        }
        if (!response.ok || errorCode !== 0) throw apiError(response, payload, options.path);
        return payload as T;
    }

    private resolvePath(
        path: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
    ): URL {
        if (!path.startsWith("/") || path.includes("..") || /%2e/iu.test(path)) {
            throw new WeComApiError("企业微信 API path 必须是安全的绝对路径", {
                code: "WECOM_INVALID_API_PATH",
                path,
            });
        }
        const url = new URL(`${this.apiBaseUrl}${path}`);
        for (const [key, value] of Object.entries(query || {}))
            if (value !== undefined) url.searchParams.set(key, String(value));
        return url;
    }

    private httpError(response: Response, path: string): never {
        throw new WeComApiError(`企业微信 API 返回 HTTP ${response.status}`, {
            code: "WECOM_HTTP_ERROR",
            status: response.status,
            path,
        });
    }
}

function validateEvent(event: WeComEvent): void {
    if (typeof event.MsgType !== "string" || !event.MsgType) {
        throw new WeComApiError("企业微信事件缺少 MsgType", {
            code: "WECOM_INVALID_EVENT",
        });
    }
    if (!Number.isFinite(event.CreateTime) || Number(event.CreateTime) <= 0) {
        throw new WeComApiError("企业微信事件缺少有效 CreateTime", {
            code: "WECOM_INVALID_EVENT",
        });
    }
    const identity = event.MsgId || event.FromUserName || event.UserID;
    if (typeof identity !== "string" || !identity) {
        throw new WeComApiError("企业微信事件缺少稳定身份字段", {
            code: "WECOM_INVALID_EVENT",
        });
    }
    if (event.MsgType !== "event" && (!event.FromUserName || !event.MsgId)) {
        throw new WeComApiError("企业微信消息缺少 FromUserName 或 MsgId", {
            code: "WECOM_INVALID_EVENT",
        });
    }
}

async function parseJson(response: Response, path: string): Promise<unknown> {
    try {
        return await response.json();
    } catch (error) {
        throw new WeComApiError("企业微信 API 返回无效 JSON", {
            code: "WECOM_INVALID_RESPONSE",
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

function apiError(response: Response, payload: unknown, path: string): WeComApiError {
    const record = payload as Record<string, unknown>;
    const code = typeof record.errcode === "number" ? record.errcode : response.status;
    const message = typeof record.errmsg === "string" ? record.errmsg : response.statusText;
    return new WeComApiError(message || `企业微信 API 调用失败: ${code}`, {
        code: `WECOM_${code}`,
        status: response.status,
        path,
        details: payload,
    });
}

function isJson(response: Response): boolean {
    return (response.headers.get("content-type") || "").includes("json");
}

function requireHttpsBase(value: string): string {
    if (!URL.canParse(value))
        throw new WeComApiError("api_base_url 必须是有效 HTTPS URL", {
            code: "WECOM_INVALID_API_BASE_URL",
        });
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new WeComApiError("api_base_url 必须是无凭据、查询参数或片段的 HTTPS URL", {
            code: "WECOM_INVALID_API_BASE_URL",
        });
    }
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}
