import { EventEmitter } from "node:events";
import { DWClient, EventAck, TOPIC_CARD, TOPIC_ROBOT } from "dingtalk-stream";
import { ErrorCategory, type Next, type RouterContext } from "onebots";
import { requireDingTalkApiPath } from "./api-path.js";
import { DingTalkCallbackCrypto } from "./crypto.js";
import { assertDingTalkConfig } from "./config.js";
import {
    getDingTalkDepartmentUsers,
    getDingTalkSceneGroupMembers,
    getDingTalkVisibleUsers,
} from "./directory-api.js";
import { DingTalkApiError, DingTalkError } from "./errors.js";
import {
    extractApiError,
    isRobotMessage,
    objectValue,
    parseObject,
    parseResponse,
    queryString,
    streamEvent,
    stringValue,
    tryParseObject,
    webhookEvent,
} from "./inbound.js";
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
import { buildSignedWebhookUrl } from "./webhook-url.js";

const MODERN_API_BASE = "https://api.dingtalk.com";
const LEGACY_API_BASE = "https://oapi.dingtalk.com";

export interface DingTalkOutboundMessage {
    msgKey: string;
    msgParam: Record<string, unknown>;
    atUserIds?: string[];
    isAtAll?: boolean;
    webhook: DingTalkWebhookMessage;
}

export interface DingTalkBotEvents {
    ready: [];
    stopped: [];
    robot_message: [message: DingTalkRobotMessage, rawEvent: unknown];
    native_event: [event: DingTalkEvent, rawEvent: unknown];
    event: [event: DingTalkEvent, rawEvent: unknown];
    error: [error: DingTalkError];
}

/** 钉钉 API、Stream 与 HTTP 回调的底层客户端。 */
export class DingTalkBot extends EventEmitter<DingTalkBotEvents> {
    private accessToken = "";
    private tokenExpireTime = 0;
    private accessTokenPromise?: Promise<string>;
    private me: DingTalkUser | null = null;
    private streamClient?: DWClient;
    private startPromise?: Promise<void>;
    private running = false;
    private generation = 0;
    private callbackCrypto?: DingTalkCallbackCrypto;
    private readonly sessionWebhooks = new Map<string, { url: string; expiresAt: number }>();

    constructor(readonly config: DingTalkConfig) {
        super();
        assertDingTalkConfig(config);
        if (config.encrypt_key) {
            if (!config.corp_id) {
                throw DingTalkError.config(
                    "钉钉加密回调必须配置 corp_id",
                    "DINGTALK_CALLBACK_CORP_ID_REQUIRED",
                );
            }
            this.callbackCrypto = new DingTalkCallbackCrypto(
                config.token || "",
                config.encrypt_key,
                config.corp_id,
            );
        }
    }

    get receiveMode(): NonNullable<DingTalkConfig["receive_mode"]> {
        return this.config.receive_mode || "stream";
    }

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

    async stop(): Promise<void> {
        const wasActive = this.running || Boolean(this.streamClient || this.startPromise);
        this.generation += 1;
        this.running = false;
        this.startPromise = undefined;
        this.streamClient?.disconnect();
        this.streamClient = undefined;
        if (wasActive) this.emit("stopped");
    }

    private async startInternal(generation: number): Promise<void> {
        try {
            if (this.receiveMode === "stream") await this.startStream(generation);
            if (this.hasAppCredentials()) await this.getAccessToken();
            if (generation !== this.generation) {
                this.streamClient?.disconnect();
                this.streamClient = undefined;
                return;
            }
            this.me ||= {
                userid: this.config.robot_code || this.config.app_key || this.config.account_id,
                name: "钉钉机器人",
            };
            this.running = true;
            this.emit("ready");
        } catch (error) {
            if (generation === this.generation) {
                this.streamClient?.disconnect();
                this.streamClient = undefined;
                this.running = false;
            }
            throw error;
        }
    }

    private async startStream(generation: number): Promise<void> {
        if (!this.config.app_key || !this.config.app_secret) {
            throw DingTalkError.config(
                "钉钉 Stream 模式必须配置 app_key 和 app_secret",
                "DINGTALK_STREAM_CREDENTIALS_REQUIRED",
            );
        }
        if (this.streamClient) return;
        const stream = new DWClient({
            clientId: this.config.app_key,
            clientSecret: this.config.app_secret,
            autoReconnect: true,
            keepAlive: true,
            debug: false,
            maxPendingEventHandlers: this.config.max_pending_event_handlers,
            maxPendingCallbackHandlers: this.config.max_pending_callback_handlers,
        });
        stream.registerCallbackListener(TOPIC_ROBOT, message => {
            if (!this.isCurrentStream(stream, generation)) return;
            const data = parseObject(message.data, "钉钉 Stream 机器人消息");
            if (!isRobotMessage(data)) {
                this.emit(
                    "error",
                    DingTalkError.protocol(
                        "钉钉 Stream 机器人消息缺少必要字段",
                        "DINGTALK_ROBOT_MESSAGE_INVALID",
                    ),
                );
                stream.socketCallBackResponse(message.headers.messageId, { success: false });
                return;
            }
            this.rememberRobot(data);
            this.emit("robot_message", data, message);
            stream.socketCallBackResponse(message.headers.messageId, { success: true });
        });
        stream.registerCallbackListener(TOPIC_CARD, message => {
            if (!this.isCurrentStream(stream, generation)) return;
            this.emit("native_event", streamEvent(message), message);
            stream.socketCallBackResponse(message.headers.messageId, { success: true });
        });
        stream.registerAllEventListener(message => {
            if (!this.isCurrentStream(stream, generation)) return { status: EventAck.SUCCESS };
            this.emit("event", streamEvent(message), message);
            return { status: EventAck.SUCCESS };
        });
        stream.on("error", error => {
            if (this.isCurrentStream(stream, generation)) {
                this.emit(
                    "error",
                    DingTalkError.wrap(error, "DINGTALK_STREAM_ERROR", ErrorCategory.NETWORK),
                );
            }
        });
        this.streamClient = stream;
        try {
            await stream.connect();
        } catch (error) {
            if (this.streamClient === stream) this.streamClient = undefined;
            stream.disconnect();
            throw DingTalkError.wrap(
                error,
                "DINGTALK_STREAM_CONNECT_FAILED",
                ErrorCategory.NETWORK,
            );
        }
        if (!this.isCurrentStream(stream, generation)) stream.disconnect();
    }

    private isCurrentStream(stream: DWClient, generation: number): boolean {
        return this.streamClient === stream && this.generation === generation;
    }

    private rememberRobot(message: DingTalkRobotMessage): void {
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
                if (!this.callbackCrypto) {
                    throw DingTalkError.config(
                        "收到加密回调但未配置 encrypt_key",
                        "DINGTALK_CALLBACK_CRYPTO_NOT_CONFIGURED",
                    );
                }
                const timestamp = queryString(ctx.query.timestamp || ctx.query.timeStamp);
                const nonce = queryString(ctx.query.nonce);
                const signature = queryString(ctx.query.signature || ctx.query.msg_signature);
                const plain = this.callbackCrypto.decrypt(encrypted, signature, timestamp, nonce);
                const decoded = tryParseObject(plain);
                if (decoded) this.ingest(decoded, body);
                ctx.body = this.callbackCrypto.encryptResponse(decoded ? "success" : plain);
                return;
            }
            if (this.config.token && body.token !== this.config.token) {
                ctx.status = 401;
                ctx.body = { error: "Invalid token" };
                return;
            }
            this.ingest(body);
            ctx.body = { success: true };
            await next();
        } catch (error) {
            const callbackError = DingTalkError.wrap(
                error,
                "DINGTALK_CALLBACK_INVALID",
                ErrorCategory.PROTOCOL,
            );
            this.emit("error", callbackError);
            ctx.status = 400;
            ctx.body = { error: callbackError.message, code: callbackError.code };
        }
    }

    /** 将已有 HTTP Host、消息队列或测试连接取得的解码载荷送入统一事件管线。 */
    ingest(rawEvent: unknown, source: unknown = rawEvent): DingTalkRobotMessage | DingTalkEvent {
        const body = objectValue(rawEvent, "钉钉事件");
        if (isRobotMessage(body)) {
            this.rememberRobot(body);
            this.emit("robot_message", body, source);
            return body;
        }
        const event = webhookEvent(body);
        this.emit("event", event, source);
        return event;
    }

    getCachedMe(): DingTalkUser | null {
        return this.me;
    }

    hasAppCredentials(): boolean {
        return Boolean(this.config.app_key && this.config.app_secret);
    }

    async getAccessToken(): Promise<string> {
        if (!this.hasAppCredentials()) {
            throw DingTalkError.config(
                "钉钉开放平台 API 需要 app_key 和 app_secret",
                "DINGTALK_API_CREDENTIALS_REQUIRED",
            );
        }
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
        if (!token) {
            throw new DingTalkApiError("获取钉钉访问令牌失败", {
                status: 200,
                platformCode: data.errcode,
                path: "/v1.0/oauth2/accessToken",
                details: data,
            });
        }
        this.accessToken = token;
        this.tokenExpireTime =
            Date.now() + ((data.expireIn || data.expires_in || 7200) - 60) * 1000;
        return token;
    }

    async callApi<T = unknown>(path: string, options: DingTalkApiRequestOptions = {}): Promise<T> {
        return this.request<T>(requireDingTalkApiPath(path), options);
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
        let response: Response;
        let text: string;
        try {
            response = await fetch(url, {
                method: options.method || "GET",
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
            });
            text = await response.text();
        } catch (error) {
            throw DingTalkError.wrap(error, "DINGTALK_NETWORK_ERROR", ErrorCategory.NETWORK, {
                path,
            });
        }
        const data = parseResponse(text, path);
        const apiError = extractApiError(data);
        if (!response.ok || apiError) {
            throw new DingTalkApiError(
                apiError?.message || response.statusText || "钉钉 API 调用失败",
                {
                    status: response.status,
                    platformCode: apiError?.code,
                    requestId: apiError?.requestId,
                    path,
                    details: data,
                },
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
                throw DingTalkError.config(
                    "当前钉钉配置无法向该会话主动发送消息",
                    "DINGTALK_OUTBOUND_ROUTE_UNAVAILABLE",
                    { receiveId, scene },
                );
            }
            return this.postWebhook(buildSignedWebhookUrl(this.config), message.webhook, false);
        }
        const robotCode = this.config.robot_code || this.config.app_key;
        if (!robotCode) {
            throw DingTalkError.config(
                "钉钉企业机器人必须配置 robot_code 或 app_key",
                "DINGTALK_ROBOT_CODE_REQUIRED",
            );
        }
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
        let response: Response;
        let text: string;
        try {
            response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(message),
            });
            text = await response.text();
        } catch (error) {
            throw DingTalkError.wrap(
                error,
                "DINGTALK_WEBHOOK_NETWORK_ERROR",
                ErrorCategory.NETWORK,
                { url },
            );
        }
        const data = parseResponse(text, "session webhook") as DingTalkWebhookResponse;
        if (!response.ok || data.errcode) {
            throw new DingTalkApiError(data.errmsg || response.statusText, {
                status: response.status,
                platformCode: data.errcode,
                path: "session webhook",
                details: data,
            });
        }
        return data;
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
