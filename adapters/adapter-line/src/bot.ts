import { EventEmitter } from "node:events";
import { LineBotClient, validateSignature, type messagingApi } from "@line/bot-sdk";
import { LineApiError } from "./errors.js";
import type { LineConfig, WebhookEvent, WebhookRequest } from "./types.js";

const DEFAULT_API_BASE = "https://api.line.me";
const DEFAULT_DATA_API_BASE = "https://api-data.line.me";
const DEFAULT_DEDUPLICATION_LIMIT = 10_000;

export interface LineEventRepository {
    has(eventId: string): boolean;
    save(eventId: string, limit: number): void;
}

/** 基于 LINE 官方 Node SDK 的客户端，只负责鉴权、收发和原始事件分发。 */
export class LineBot extends EventEmitter {
    private readonly client: LineBotClient;
    private readonly processedEvents = new Set<string>();

    constructor(
        private readonly config: LineConfig,
        private readonly eventRepository?: LineEventRepository,
    ) {
        super();
        this.client = LineBotClient.fromChannelAccessToken({
            channelAccessToken: config.channel_access_token,
            apiBaseURL: requireHttpsUrl(config.api_base_url || DEFAULT_API_BASE, "api_base_url"),
            dataApiBaseURL: requireHttpsUrl(
                config.data_api_base_url || DEFAULT_DATA_API_BASE,
                "data_api_base_url",
            ),
        });
    }

    getClient(): LineBotClient {
        return this.client;
    }

    validateSignature(body: string | Buffer, signature: string): boolean {
        return validateSignature(body, this.config.channel_secret, signature);
    }

    /** 验证未经修改的原始请求体，并将同一批事件依次交给统一分发路径。 */
    ingest(body: string | Buffer, signature: string): number {
        if (!signature || !this.validateSignature(body, signature)) {
            throw new LineApiError("LINE Webhook 签名验证失败", {
                code: "LINE_INVALID_SIGNATURE",
                status: 401,
            });
        }
        const request = parseWebhookRequest(body);
        let accepted = 0;
        for (const event of request.events) {
            if (this.isDuplicate(event)) continue;
            this.emit("event", event);
            this.emit(event.type, event);
            this.markProcessed(event.webhookEventId);
            accepted += 1;
        }
        return accepted;
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
            return await this.client.getBotInfo();
        } catch (error) {
            throw LineApiError.wrap(error, "LINE_GET_BOT_INFO_ERROR");
        }
    }

    private isDuplicate(event: WebhookEvent): boolean {
        if (this.config.deduplicate_webhooks === false || !event.webhookEventId) return false;
        if (this.eventRepository) return this.eventRepository.has(event.webhookEventId);
        return this.processedEvents.has(event.webhookEventId);
    }

    private markProcessed(eventId: string): void {
        if (this.config.deduplicate_webhooks === false || !eventId) return;
        const limit = Math.max(
            100,
            Math.floor(this.config.webhook_deduplication_limit || DEFAULT_DEDUPLICATION_LIMIT),
        );
        if (this.eventRepository) {
            this.eventRepository.save(eventId, limit);
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw invalidWebhookBody();
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.destination !== "string" || !Array.isArray(record.events)) {
        throw invalidWebhookBody();
    }
    if (!record.events.every(isWebhookEvent)) throw invalidWebhookBody();
    return { destination: record.destination, events: record.events };
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
    if (!URL.canParse(value) || new URL(value).protocol !== "https:") {
        throw new LineApiError(`LINE 配置 ${name} 必须是有效 HTTPS URL`, {
            code: "LINE_INVALID_CONFIG_URL",
            details: value,
        });
    }
    return value.replace(/\/$/u, "");
}
