import { EventEmitter } from "node:events";
import { DWClient } from "dingtalk-stream";
import { emitAwaited, ErrorCategory, type Next, type RouterContext } from "onebots";
import { DingTalkApiClient } from "./api-client.js";
import { DingTalkCallbackCrypto } from "./crypto.js";
import { assertDingTalkConfig } from "./config.js";
import {
    getDingTalkDepartmentUsers,
    getDingTalkSceneGroupMembers,
    getDingTalkVisibleUsers,
} from "./directory-api.js";
import { DingTalkError } from "./errors.js";
import {
    isRobotMessage,
    objectValue,
    queryString,
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
    DingTalkUser,
    DingTalkUserGetResponse,
    DingTalkWebhookMessage,
    DingTalkWebhookResponse,
} from "./types.js";
import { buildSignedWebhookUrl } from "./webhook-url.js";
import { DingTalkEventIngress } from "./event-ingress.js";
import { registerDingTalkStreamHandlers } from "./stream-handlers.js";

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
    private readonly api: DingTalkApiClient;
    private me: DingTalkUser | null = null;
    private streamClient?: DWClient;
    private startPromise?: Promise<void>;
    private running = false;
    private generation = 0;
    private callbackCrypto?: DingTalkCallbackCrypto;
    private readonly eventIngress = new DingTalkEventIngress();
    private readonly sessionWebhooks = new Map<string, { url: string; expiresAt: number }>();

    constructor(readonly config: DingTalkConfig) {
        super();
        assertDingTalkConfig(config);
        this.api = new DingTalkApiClient(config);
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
        registerDingTalkStreamHandlers(stream, {
            isCurrent: () => this.isCurrentStream(stream, generation),
            robot: (message, raw) => this.deliverRobot(message, raw),
            card: (event, raw) => this.deliverEvent(event, raw, "native_event"),
            event: (event, raw) => this.deliverEvent(event, raw, "event"),
            error: error => this.emit("error", error),
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
        let dispatching = false;
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
                if (decoded) {
                    dispatching = true;
                    await this.ingest(decoded, body);
                }
                ctx.body = this.callbackCrypto.encryptResponse(decoded ? "success" : plain);
                return;
            }
            if (this.config.token && body.token !== this.config.token) {
                ctx.status = 401;
                ctx.body = { error: "Invalid token" };
                return;
            }
            dispatching = true;
            await this.ingest(body);
            ctx.body = { success: true };
            await next();
        } catch (error) {
            const callbackError = DingTalkError.wrap(
                error,
                "DINGTALK_CALLBACK_INVALID",
                ErrorCategory.PROTOCOL,
            );
            this.emit("error", callbackError);
            ctx.status = dispatching ? 500 : 400;
            ctx.body = { error: callbackError.message, code: callbackError.code };
        }
    }

    /** 将已有 HTTP Host、消息队列或测试连接取得的解码载荷送入统一事件管线。 */
    async ingest(
        rawEvent: unknown,
        source: unknown = rawEvent,
    ): Promise<DingTalkRobotMessage | DingTalkEvent> {
        const body = objectValue(rawEvent, "钉钉事件");
        if (isRobotMessage(body)) {
            await this.deliverRobot(body, source);
            return body;
        }
        const event = webhookEvent(body);
        await this.deliverEvent(event, source, "event");
        return event;
    }

    /** 返回已发现的机器人 userid；初始化阶段回退到企业机器人或应用标识。 */
    getPlatformBotId(): string {
        return (
            this.me?.userid ||
            this.config.robot_code ||
            this.config.app_key ||
            this.config.agent_id ||
            this.config.account_id
        );
    }

    getCachedMe(): DingTalkUser | null {
        return this.me;
    }

    private async deliverRobot(message: DingTalkRobotMessage, raw: unknown): Promise<void> {
        this.rememberRobot(message);
        await this.eventIngress.deliverRobot(message, () =>
            emitAwaited(this, "robot_message", message, raw),
        );
    }

    private async deliverEvent(
        event: DingTalkEvent,
        raw: unknown,
        channel: "event" | "native_event",
    ): Promise<void> {
        await this.eventIngress.deliverEvent(event, () => emitAwaited(this, channel, event, raw));
    }

    hasAppCredentials(): boolean {
        return this.api.hasCredentials();
    }

    async getAccessToken(): Promise<string> {
        return this.api.getAccessToken();
    }

    async callApi<T = unknown>(path: string, options: DingTalkApiRequestOptions = {}): Promise<T> {
        return this.api.call<T>(path, options);
    }

    async sendMessage(
        receiveId: string,
        scene: "private" | "group",
        message: DingTalkOutboundMessage,
    ): Promise<DingTalkSendResult | DingTalkWebhookResponse> {
        const session = this.sessionWebhooks.get(receiveId);
        if (session && session.expiresAt > Date.now()) {
            return this.api.postWebhook(session.url, message.webhook, true);
        }
        if (!this.hasAppCredentials()) {
            if (scene !== "group" || !this.config.webhook_url) {
                throw DingTalkError.config(
                    "当前钉钉配置无法向该会话主动发送消息",
                    "DINGTALK_OUTBOUND_ROUTE_UNAVAILABLE",
                    { receiveId, scene },
                );
            }
            return this.api.postWebhook(buildSignedWebhookUrl(this.config), message.webhook, false);
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
