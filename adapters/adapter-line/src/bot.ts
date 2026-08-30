import { EventEmitter } from "node:events";
import { LineBotClient, validateSignature, type messagingApi } from "@line/bot-sdk";
import { emitAllAwaited, ReliableEventIngress } from "onebots";
import type { LineBotEvents } from "./bot-events.js";
import { LineApiError } from "./errors.js";
import {
    applyLineHttpResponse,
    isLineFetchRequest,
    LINE_JSON_HEADERS,
    lineMethodNotAllowed,
    toLineFetchResponse,
} from "./http-bridge.js";
import type {
    LineConfig,
    LineHttpContext,
    LineHttpRequest,
    LineHttpResponse,
    LineIngestResult,
    WebhookEvent,
    WebhookRequest,
} from "./types.js";

export type { LineBotEvents } from "./bot-events.js";

const DEFAULT_API_BASE = "https://api.line.me";
const DEFAULT_DATA_API_BASE = "https://api-data.line.me";
const DEFAULT_DEDUPLICATION_LIMIT = 10_000;

export interface LineEventRepository {
    has(eventId: string): boolean;
    save(eventId: string, limit: number): void;
}

export interface LineBotDependencies {
    eventRepository?: LineEventRepository;
    reportError?(error: LineApiError): void;
}

/** 基于 LINE 官方 Node SDK 的客户端，只负责鉴权、收发和原始事件分发。 */
export class LineBot extends EventEmitter<LineBotEvents> {
    private readonly client: LineBotClient;
    private readonly processedEvents = new Set<string>();
    private readonly eventIngress: ReliableEventIngress<string>;
    private readonly dependencies: LineBotDependencies;
    private botUserId?: string;

    constructor(
        private readonly config: LineConfig,
        dependencies: LineBotDependencies = {},
    ) {
        super();
        this.dependencies = dependencies;
        assertLineConfig(config);
        this.botUserId = config.destination;
        this.client = LineBotClient.fromChannelAccessToken({
            channelAccessToken: config.channel_access_token,
            apiBaseURL: requireHttpsUrl(config.api_base_url || DEFAULT_API_BASE, "api_base_url"),
            dataApiBaseURL: requireHttpsUrl(
                config.data_api_base_url || DEFAULT_DATA_API_BASE,
                "data_api_base_url",
            ),
        });
        this.eventIngress = new ReliableEventIngress({
            has: eventId => this.hasProcessed(eventId),
            commit: eventId => this.markProcessed(eventId),
        });
    }

    getClient(): LineBotClient {
        return this.client;
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receive_mode || "webhook";
    }

    /** LINE Official Account 的真实 user ID，优先来自 Webhook destination 或身份接口。 */
    getBotUserId(): string | undefined {
        return this.botUserId;
    }

    validateSignature(body: string | Buffer, signature: string): boolean {
        if (!this.config.channel_secret) {
            throw new LineApiError("LINE Webhook 验签需要 channel_secret", {
                code: "LINE_CHANNEL_SECRET_REQUIRED",
            });
        }
        return validateSignature(body, this.config.channel_secret, signature);
    }

    /** 最低层事件入口，可接收单个官方事件或完整 CallbackRequest。 */
    async ingest(rawEvent: unknown): Promise<LineIngestResult> {
        const request = parseIngestRequest(rawEvent);
        const expectedDestination = this.config.destination || this.botUserId;
        if (
            expectedDestination &&
            request.destination &&
            request.destination !== expectedDestination
        ) {
            throw new LineApiError("LINE Webhook destination 与当前机器人不匹配", {
                code: "LINE_DESTINATION_MISMATCH",
                status: 400,
                details: { destination: request.destination },
            });
        }
        this.botUserId ||= request.destination || undefined;
        const events: WebhookEvent[] = [];
        let duplicate = 0;
        for (const event of request.events) {
            const delivered = await this.deliverEvent(event);
            if (!delivered) {
                duplicate += 1;
                continue;
            }
            events.push(event);
        }
        return { accepted: events.length, duplicate, events };
    }

    /** 验签、解析和投递均在这里完成，所有 HTTP Host 共享同一响应策略。 */
    async ingestHttp(request: LineHttpRequest): Promise<LineHttpResponse> {
        if (request.method.toUpperCase() !== "POST") return lineMethodNotAllowed();
        try {
            if (typeof request.body !== "string" && !Buffer.isBuffer(request.body)) {
                throw new LineApiError("LINE Webhook 必须保留未经修改的 rawBody", {
                    code: "LINE_RAW_BODY_REQUIRED",
                    status: 400,
                });
            }
            if (!request.signature || !this.validateSignature(request.body, request.signature)) {
                throw new LineApiError("LINE Webhook 签名验证失败", {
                    code: "LINE_INVALID_SIGNATURE",
                    status: 401,
                });
            }
            const ingest = await this.ingest(parseWebhookRequest(request.body));
            return {
                status: 200,
                headers: LINE_JSON_HEADERS,
                body: { ok: true, accepted: ingest.accepted, duplicate: ingest.duplicate },
                ingest,
            };
        } catch (error) {
            const wrapped = LineApiError.wrap(error, "LINE_WEBHOOK_ERROR");
            this.dependencies.reportError?.(wrapped);
            return {
                status: wrapped.status || 500,
                headers: LINE_JSON_HEADERS,
                body: { error: { code: wrapped.code, message: wrapped.message } },
            };
        }
    }

    /** Fetch / WinterCG 与 Koa 风格 Host 都可直接转交请求，无需另开端口。 */
    async acceptHttp(request: Request): Promise<Response>;
    async acceptHttp(context: LineHttpContext): Promise<void>;
    async acceptHttp(input: Request | LineHttpContext): Promise<Response | void> {
        if (isLineFetchRequest(input)) {
            const response = await this.ingestHttp({
                method: input.method,
                body: input.method === "POST" ? Buffer.from(await input.arrayBuffer()) : undefined,
                signature: input.headers.get("x-line-signature") || undefined,
            });
            return toLineFetchResponse(response);
        }
        const rawBody = input.request.rawBody;
        const response = await this.ingestHttp({
            method: input.method,
            body: typeof rawBody === "string" || Buffer.isBuffer(rawBody) ? rawBody : undefined,
            signature: input.get("x-line-signature") || undefined,
        });
        applyLineHttpResponse(input, response);
    }

    async pushMessage(
        to: string,
        messages: messagingApi.Message[],
        options: {
            retryKey?: string;
            notificationDisabled?: boolean;
            customAggregationUnits?: string[];
        } = {},
    ): Promise<messagingApi.PushMessageResponse> {
        try {
            return await this.client.pushMessage(
                {
                    to,
                    messages: requireMessages(messages),
                    notificationDisabled: options.notificationDisabled,
                    customAggregationUnits: options.customAggregationUnits,
                },
                options.retryKey,
            );
        } catch (error) {
            throw LineApiError.wrap(error, "LINE_PUSH_MESSAGE_ERROR");
        }
    }

    async replyMessage(
        replyToken: string,
        messages: messagingApi.Message[],
        notificationDisabled?: boolean,
    ): Promise<messagingApi.ReplyMessageResponse> {
        try {
            return await this.client.replyMessage({
                replyToken,
                messages: requireMessages(messages),
                notificationDisabled,
            });
        } catch (error) {
            throw LineApiError.wrap(error, "LINE_REPLY_MESSAGE_ERROR");
        }
    }

    async getBotInfo(): Promise<messagingApi.BotInfoResponse> {
        try {
            const info = await this.client.getBotInfo();
            this.botUserId = info.userId;
            return info;
        } catch (error) {
            throw LineApiError.wrap(error, "LINE_GET_BOT_INFO_ERROR");
        }
    }

    /** 按官方 type 订阅具体事件，并返回取消订阅函数。 */
    onEvent<K extends WebhookEvent["type"]>(
        type: K,
        listener: (event: Extract<WebhookEvent, { type: K }>) => void | PromiseLike<void>,
    ): () => void {
        const wrapped = async (event: WebhookEvent): Promise<void> => {
            if (event.type === type) {
                await listener(event as Extract<WebhookEvent, { type: K }>);
            }
        };
        this.on("event", wrapped);
        return () => this.off("event", wrapped);
    }

    private deliverEvent(event: WebhookEvent): Promise<boolean> {
        const dispatch = () => emitAllAwaited(this, "event", event);
        if (this.config.deduplicate_webhooks === false || !event.webhookEventId) {
            return dispatch().then(() => true);
        }
        return this.eventIngress.deliver(event.webhookEventId, dispatch);
    }

    private hasProcessed(eventId: string): boolean {
        return this.dependencies.eventRepository
            ? this.dependencies.eventRepository.has(eventId)
            : this.processedEvents.has(eventId);
    }

    private markProcessed(eventId: string): void {
        const limit = Math.max(
            100,
            Math.floor(this.config.webhook_deduplication_limit || DEFAULT_DEDUPLICATION_LIMIT),
        );
        if (this.dependencies.eventRepository) {
            this.dependencies.eventRepository.save(eventId, limit);
            return;
        }
        this.processedEvents.add(eventId);
        while (this.processedEvents.size > limit) {
            const oldest = this.processedEvents.values().next().value;
            if (typeof oldest !== "string") break;
            this.processedEvents.delete(oldest);
        }
    }
}

function parseIngestRequest(value: unknown): WebhookRequest {
    if (isWebhookEvent(value)) {
        return { destination: "", events: [value] };
    }
    return parseWebhookValue(value);
}

function parseWebhookRequest(body: string | Buffer): WebhookRequest {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.toString()) as unknown;
    } catch (error) {
        throw new LineApiError("LINE Webhook 请求体不是有效 JSON", {
            code: "LINE_INVALID_WEBHOOK_BODY",
            status: 400,
            cause: error,
        });
    }
    return parseWebhookValue(parsed);
}

function parseWebhookValue(parsed: unknown): WebhookRequest {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidWebhookBody();
    const record = parsed as Record<string, unknown>;
    if (typeof record.destination !== "string" || !Array.isArray(record.events)) {
        throw invalidWebhookBody();
    }
    if (!record.events.every(isWebhookEvent)) throw invalidWebhookBody();
    return { destination: record.destination, events: record.events };
}

function assertLineConfig(config: LineConfig): void {
    if (!config.account_id?.trim()) {
        throw new LineApiError("LINE account_id 不能为空", { code: "LINE_ACCOUNT_ID_REQUIRED" });
    }
    if (!config.channel_access_token?.trim()) {
        throw new LineApiError("LINE channel_access_token 不能为空", {
            code: "LINE_ACCESS_TOKEN_REQUIRED",
        });
    }
    const receiveMode = config.receive_mode || "webhook";
    if (receiveMode !== "webhook" && receiveMode !== "manual") {
        throw new LineApiError("LINE receive_mode 仅支持 webhook 或 manual", {
            code: "LINE_RECEIVE_MODE_INVALID",
        });
    }
    if (receiveMode === "webhook" && !config.channel_secret?.trim()) {
        throw new LineApiError("LINE Webhook 模式必须配置 channel_secret", {
            code: "LINE_CHANNEL_SECRET_REQUIRED",
        });
    }
    if (
        config.webhook_deduplication_limit !== undefined &&
        (!Number.isInteger(config.webhook_deduplication_limit) ||
            config.webhook_deduplication_limit < 100)
    ) {
        throw new LineApiError("LINE webhook_deduplication_limit 必须是大于等于 100 的整数", {
            code: "LINE_DEDUPLICATION_LIMIT_INVALID",
        });
    }
}

function isWebhookEvent(value: unknown): value is WebhookEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.type === "string" &&
        typeof record.timestamp === "number" &&
        typeof record.webhookEventId === "string"
    );
}

function invalidWebhookBody(): LineApiError {
    return new LineApiError("LINE Webhook 请求体结构无效", {
        code: "LINE_INVALID_WEBHOOK_BODY",
        status: 400,
    });
}

function requireMessages(messages: messagingApi.Message[]): messagingApi.Message[] {
    if (messages.length < 1 || messages.length > 5) {
        throw new LineApiError("LINE 每次请求必须包含 1 到 5 条消息", {
            code: "LINE_INVALID_MESSAGE_COUNT",
            details: messages.length,
        });
    }
    return messages;
}

function requireHttpsUrl(value: string, name: string): string {
    if (!URL.canParse(value)) {
        throw new LineApiError(`LINE 配置 ${name} 必须是有效 HTTPS URL`, {
            code: "LINE_INVALID_CONFIG_URL",
            details: value,
        });
    }
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new LineApiError(`LINE 配置 ${name} 必须是无凭据和查询语义的 HTTPS URL`, {
            code: "LINE_INVALID_CONFIG_URL",
            details: value,
        });
    }
    return url.toString().replace(/\/$/u, "");
}
