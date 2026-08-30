import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
    emitAllAwaited,
    isSafeAbsoluteApiPath,
    KeyedSingleFlight,
    RefreshableValue,
} from "onebots";
import { WeComApiError } from "./errors.js";
import { assertWeComConfig, resolveWeComApiBaseUrl } from "./client-config.js";
import {
    apiError,
    apiErrorCode,
    isJson,
    parseJson,
    responseFromWebhook,
} from "./client-response.js";
import { deliverWeComEvent } from "./event-delivery.js";
import type {
    WeComAgent,
    WeComAppChat,
    WeComCallOptions,
    WeComClientEvents,
    WeComConfig,
    WeComDepartmentMembersResponse,
    WeComEvent,
    WeComIngestResult,
    WeComNamedEvent,
    WeComSendMessageResponse,
    WeComTokenResponse,
    WeComUser,
    WeComWebhookRequest,
    WeComWebhookResponse,
} from "./types.js";
import { decodeWeComEvent, verifyWeComEndpoint, weComEventId } from "./webhook.js";

const DEFAULT_API_BASE = "https://qyapi.weixin.qq.com";
const TOKEN_MARGIN_MS = 120_000;
const INVALID_TOKEN_CODES = new Set([40014, 42001, 42007, 42009]);
const DEFAULT_DEDUPLICATION_LIMIT = 10_000;

/** 企业微信自建应用 API 客户端与统一事件入口。 */
export class WeComClient extends EventEmitter<WeComClientEvents> {
    readonly apiBaseUrl: string;
    private readonly tokens = new RefreshableValue<string>(TOKEN_MARGIN_MS);
    private readonly directoryTokens = new RefreshableValue<string>(TOKEN_MARGIN_MS);
    private agent?: WeComAgent;
    private startPromise?: Promise<WeComAgent>;
    private generation = 0;
    private running = false;
    private lifecycleActive = false;
    private readonly processedEvents = new Set<string>();
    private readonly eventFlights = new KeyedSingleFlight<string, WeComIngestResult>();

    constructor(
        readonly config: WeComConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        super();
        assertWeComConfig(config);
        if (!/^\d+$/u.test(config.agent_id)) {
            throw new WeComApiError("agent_id 必须是数字字符串", {
                code: "WECOM_INVALID_AGENT_ID",
            });
        }
        this.apiBaseUrl = resolveWeComApiBaseUrl(config.api_base_url || DEFAULT_API_BASE);
    }

    async start(): Promise<WeComAgent> {
        if (this.running && this.agent) return this.agent;
        if (this.startPromise) return this.startPromise;
        this.lifecycleActive = true;
        const generation = this.generation;
        const start = this.startInternal(generation);
        this.startPromise = start;
        try {
            return await start;
        } finally {
            if (this.startPromise === start) this.startPromise = undefined;
        }
    }

    private async startInternal(generation: number): Promise<WeComAgent> {
        await this.getAccessToken();
        const agent = await this.getAgent();
        this.assertStartGeneration(generation);
        this.agent = agent;
        try {
            await emitAllAwaited(this, "ready", agent);
            this.assertStartGeneration(generation);
            this.running = true;
            return agent;
        } catch (error) {
            if (generation === this.generation) this.agent = undefined;
            throw error;
        }
    }

    async stop(): Promise<void> {
        const wasActive = this.lifecycleActive;
        this.lifecycleActive = false;
        this.generation += 1;
        this.running = false;
        this.startPromise = undefined;
        this.agent = undefined;
        this.tokens.clear();
        this.directoryTokens.clear();
        this.eventFlights.clear();
        if (wasActive) await emitAllAwaited(this, "stop");
    }

    private assertStartGeneration(generation: number): void {
        if (generation !== this.generation) {
            throw new WeComApiError("企业微信启动已被停止", {
                code: "WECOM_START_CANCELLED",
            });
        }
    }

    getCachedAgent(): WeComAgent | undefined {
        return this.agent;
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receive_mode || "webhook";
    }

    async getAccessToken(force = false): Promise<string> {
        return this.tokens.get(() => this.fetchToken(this.config.corp_secret), force);
    }

    /** 获取独立的通讯录同步 token，避免以应用 token 伪装写通讯录权限。 */
    async getDirectoryAccessToken(force = false): Promise<string> {
        const secret = this.config.directory_secret;
        if (!secret) {
            throw new WeComApiError("通讯录写入动作需要配置 directory_secret", {
                code: "WECOM_DIRECTORY_SECRET_REQUIRED",
            });
        }
        return this.directoryTokens.get(() => this.fetchToken(secret), force);
    }

    call<T = unknown>(options: WeComCallOptions): Promise<T> {
        return this.performCall<T>(options, true, "application");
    }

    /** 使用通讯录同步 Secret 调用受限接口。 */
    callDirectory<T = unknown>(options: WeComCallOptions): Promise<T> {
        return this.performCall<T>(options, true, "directory");
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
        return this.uploadMedia(type, data, filename, "application");
    }

    /** 上传供异步通讯录导入使用的 CSV 文件。 */
    async uploadDirectoryFile(
        data: Blob,
        filename = "directory.csv",
    ): Promise<{ media_id: string; created_at: string }> {
        return this.uploadMedia("file", data, filename, "directory");
    }

    private async uploadMedia(
        type: "image" | "voice" | "video" | "file",
        data: Blob,
        filename: string,
        scope: WeComTokenScope,
    ): Promise<{ media_id: string; created_at: string }> {
        const form = new FormData();
        form.set("media", data, filename);
        const result = await this.performCall<{ media_id?: unknown; created_at?: unknown }>(
            {
                method: "POST",
                path: "/cgi-bin/media/upload",
                query: { type },
                body: form,
            },
            true,
            scope,
        );
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

    /** 最底层明文事件入口，与加密 HTTP 回调共享校验、去重和 typed 分发。 */
    async ingest(rawEvent: unknown): Promise<WeComIngestResult> {
        const event = parseWeComEvent(rawEvent);
        validateEvent(event);
        const eventId = weComEventId(event);
        if (this.isDuplicate(eventId)) {
            return { accepted: 0, duplicate: true, eventId, event };
        }
        return this.eventFlights.run(eventId, async () => {
            if (this.isDuplicate(eventId)) {
                return { accepted: 0, duplicate: true, eventId, event };
            }
            await deliverWeComEvent(this, event);
            this.markProcessed(eventId);
            return { accepted: 1, duplicate: false, eventId, event };
        });
    }

    /** 按企业微信 Event 精确订阅，并返回取消订阅函数。 */
    onEvent<K extends string>(
        name: K,
        listener: (event: WeComNamedEvent<K>) => unknown,
    ): () => void {
        const wrapped = async (event: WeComEvent): Promise<void> => {
            if (event.Event?.toLowerCase() === name.toLowerCase()) {
                await listener(event as WeComNamedEvent<K>);
            }
        };
        this.on("event", wrapped);
        return () => this.off("event", wrapped);
    }

    /** 接收企业微信 GET 验证或 POST 加密回调。 */
    async ingestHttp(request: WeComWebhookRequest): Promise<WeComWebhookResponse> {
        if (request.method === "GET") {
            const echo = verifyWeComEndpoint(this.config, request.query);
            return echo === undefined
                ? { status: 403, body: "Invalid msg_signature", contentType: "text/plain" }
                : { status: 200, body: echo, contentType: "text/plain" };
        }
        try {
            const ingest = await this.ingest(decodeWeComEvent(this.config, request));
            return { status: 200, body: "success", contentType: "text/plain", ingest };
        } catch (error) {
            if (error instanceof WeComApiError && error.code === "WECOM_INVALID_SIGNATURE") {
                return { status: 403, body: "Invalid msg_signature", contentType: "text/plain" };
            }
            throw error;
        }
    }

    /** Fetch / WinterCG Host 可直接转交标准 Request。 */
    async acceptHttp(request: Request): Promise<Response> {
        const method = request.method.toUpperCase();
        if (method !== "GET" && method !== "POST") {
            return Response.json(
                { error: { code: "WECOM_METHOD_NOT_ALLOWED", message: "Method Not Allowed" } },
                { status: 405, headers: { Allow: "GET, POST" } },
            );
        }
        try {
            const response = await this.ingestHttp({
                method,
                query: Object.fromEntries(new URL(request.url).searchParams),
                body: method === "POST" ? Buffer.from(await request.arrayBuffer()) : undefined,
            });
            return responseFromWebhook(response);
        } catch (error) {
            const wrapped = WeComApiError.wrap(error, "WECOM_WEBHOOK_ERROR");
            return Response.json(
                { error: { code: wrapped.code, message: wrapped.message } },
                { status: wrapped.status || 400 },
            );
        }
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

    private async fetchToken(secret: string): Promise<{ value: string; ttlMs: number }> {
        const result = await this.performCall<WeComTokenResponse>(
            {
                path: "/cgi-bin/gettoken",
                token: false,
                query: { corpid: this.config.corp_id, corpsecret: secret },
            },
            false,
            "application",
        );
        if (!result.access_token || !result.expires_in) {
            throw new WeComApiError("企业微信 access_token 响应缺少必要字段", {
                code: "WECOM_INVALID_TOKEN_RESPONSE",
                details: result,
            });
        }
        return { value: result.access_token, ttlMs: result.expires_in * 1000 };
    }

    private async performCall<T>(
        options: WeComCallOptions,
        retryToken: boolean,
        scope: WeComTokenScope,
    ): Promise<T> {
        const url = this.resolvePath(options.path, options.query);
        const requestToken =
            options.token === false
                ? undefined
                : scope === "directory"
                  ? await this.getDirectoryAccessToken()
                  : await this.getAccessToken();
        if (requestToken) url.searchParams.set("access_token", requestToken);
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
            const tokenStore = scope === "directory" ? this.directoryTokens : this.tokens;
            if (requestToken && tokenStore.invalidate(requestToken)) {
                if (scope === "directory") await this.getDirectoryAccessToken(true);
                else await this.getAccessToken(true);
            }
            return this.performCall<T>(options, false, scope);
        }
        if (!response.ok || errorCode !== 0) throw apiError(response, payload, options.path);
        return payload as T;
    }

    private resolvePath(
        path: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
    ): URL {
        if (!isSafeAbsoluteApiPath(path)) {
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

type WeComTokenScope = "application" | "directory";

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

function parseWeComEvent(value: unknown): WeComEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new WeComApiError("企业微信事件必须是对象", { code: "WECOM_INVALID_EVENT" });
    }
    return value as WeComEvent;
}
