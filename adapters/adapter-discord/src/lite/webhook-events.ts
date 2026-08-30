import { ReliableEventIngress } from "onebots";
import { DiscordError } from "../errors.js";
import {
    interactionFetchResponse,
    interactionHttpError,
    isInteractionTimestampFresh,
    verifyInteractionSignature,
} from "./interaction-http.js";
import type {
    DiscordInteractionHttpRequest,
    DiscordInteractionHttpResponse,
} from "./interactions.js";

export type DiscordWebhookEventType =
    | "APPLICATION_AUTHORIZED"
    | "APPLICATION_DEAUTHORIZED"
    | "ENTITLEMENT_CREATE"
    | "ENTITLEMENT_UPDATE"
    | "ENTITLEMENT_DELETE"
    | "QUEST_USER_ENROLLMENT"
    | "LOBBY_MESSAGE_CREATE"
    | "LOBBY_MESSAGE_UPDATE"
    | "LOBBY_MESSAGE_DELETE"
    | "GAME_DIRECT_MESSAGE_CREATE"
    | "GAME_DIRECT_MESSAGE_UPDATE"
    | "GAME_DIRECT_MESSAGE_DELETE"
    | (string & Record<never, never>);

export interface DiscordWebhookEvent {
    type: DiscordWebhookEventType;
    timestamp: string;
    data?: unknown;
}

export interface DiscordWebhookEventPayload {
    version: 1;
    application_id: string;
    type: 1;
    event: DiscordWebhookEvent;
}

export interface DiscordWebhookPingPayload {
    version: 1;
    application_id: string;
    type: 0;
}

export type DiscordWebhookPayload = DiscordWebhookPingPayload | DiscordWebhookEventPayload;

export interface DiscordWebhookEventsOptions {
    publicKey?: string;
    applicationId?: string;
    /** 仅允许注入已经由上游验签的事件；本实例不会接受 HTTP 请求。 */
    trustedIngress?: boolean;
    maxTimestampAgeMs?: number;
    onEvent?: (payload: DiscordWebhookEventPayload) => void | PromiseLike<void>;
}

/** Discord Webhook Events 接收器；验签、并发合并与成功提交构成同一可靠入口。 */
export class DiscordWebhookEventsReceiver {
    private readonly ingress = new ReliableEventIngress<string>();
    private readonly maxTimestampAgeMs: number;

    constructor(private readonly options: DiscordWebhookEventsOptions) {
        if (!options.trustedIngress && !/^[\da-f]{64}$/i.test(options.publicKey ?? "")) {
            throw DiscordError.configuration(
                "Discord Webhook Events publicKey 必须是 32 字节十六进制公钥",
                "DISCORD_WEBHOOK_PUBLIC_KEY_INVALID",
            );
        }
        if (!options.trustedIngress && !options.applicationId?.trim()) {
            throw DiscordError.configuration(
                "Discord Webhook Events applicationId 不能为空",
                "DISCORD_WEBHOOK_APPLICATION_ID_REQUIRED",
            );
        }
        this.maxTimestampAgeMs = options.maxTimestampAgeMs ?? 300_000;
        if (this.maxTimestampAgeMs < 0) {
            throw DiscordError.configuration(
                "maxTimestampAgeMs 不能小于 0",
                "DISCORD_WEBHOOK_TIMESTAMP_WINDOW_INVALID",
            );
        }
    }

    async acceptHttp(request: Request): Promise<Response> {
        const response = await this.ingestHttp({
            method: request.method,
            signature: request.headers.get("x-signature-ed25519") ?? undefined,
            timestamp: request.headers.get("x-signature-timestamp") ?? undefined,
            body: await request.text(),
        });
        return response.status === 204
            ? new Response(null, { status: 204, headers: response.headers })
            : interactionFetchResponse(response);
    }

    async ingestHttp(
        request: DiscordInteractionHttpRequest,
    ): Promise<DiscordInteractionHttpResponse> {
        if ((request.method ?? "POST").toUpperCase() !== "POST") {
            return interactionHttpError(
                405,
                "DISCORD_WEBHOOK_METHOD_NOT_ALLOWED",
                "Discord Webhook Events 入口只接受 POST",
            );
        }
        const { signature, timestamp, body } = request;
        if (!this.options.publicKey) {
            return interactionHttpError(
                503,
                "DISCORD_WEBHOOK_PUBLIC_KEY_REQUIRED",
                "Discord manual 模式未启用本地 HTTP 验签",
            );
        }
        if (!signature || !timestamp) return interactionHttpError(401, "missing_signature");
        if (!isInteractionTimestampFresh(timestamp, this.maxTimestampAgeMs)) {
            return interactionHttpError(401, "expired_signature");
        }
        if (
            !(await verifyInteractionSignature(this.options.publicKey, signature, timestamp, body))
        ) {
            return interactionHttpError(401, "invalid_signature");
        }

        let rawEvent: unknown;
        try {
            rawEvent = JSON.parse(body) as unknown;
        } catch {
            return interactionHttpError(
                400,
                "DISCORD_WEBHOOK_INVALID_JSON",
                "Discord Webhook Events 请求体不是有效 JSON",
            );
        }
        try {
            await this.ingest(rawEvent);
            return {
                status: 204,
                headers: DISCORD_WEBHOOK_RESPONSE_HEADERS,
                body: null,
            };
        } catch (error) {
            const wrapped = DiscordError.wrap(error, "DISCORD_WEBHOOK_INGEST_FAILED");
            return interactionHttpError(
                wrapped.code === "DISCORD_WEBHOOK_INVALID" ? 400 : 500,
                wrapped.code,
                wrapped.code === "DISCORD_WEBHOOK_INVALID"
                    ? wrapped.message
                    : "Discord Webhook Event 处理失败",
            );
        }
    }

    async ingest(rawEvent: unknown): Promise<DiscordWebhookPayload> {
        if (!isDiscordWebhookPayload(rawEvent)) {
            throw DiscordError.invalid(
                "Discord Webhook Event 缺少有效的 version、application_id、type 或 event",
                "DISCORD_WEBHOOK_INVALID",
            );
        }
        if (this.options.applicationId && rawEvent.application_id !== this.options.applicationId) {
            throw DiscordError.invalid(
                "Discord Webhook Event application_id 与当前应用不匹配",
                "DISCORD_WEBHOOK_INVALID",
            );
        }
        if (rawEvent.type === 0) return rawEvent;

        try {
            const key = webhookEventKey(rawEvent);
            await this.ingress.deliver(key, () => this.options.onEvent?.(rawEvent));
            return rawEvent;
        } catch (error) {
            throw DiscordError.wrap(error, "DISCORD_WEBHOOK_EVENT_DELIVERY_FAILED");
        }
    }
}

export function isDiscordWebhookPayload(value: unknown): value is DiscordWebhookPayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const payload = value as Record<string, unknown>;
    if (payload.version !== 1 || typeof payload.application_id !== "string") return false;
    if (payload.type === 0) return true;
    if (payload.type !== 1 || !payload.event || typeof payload.event !== "object") return false;
    const event = payload.event as Record<string, unknown>;
    return (
        typeof event.type === "string" &&
        typeof event.timestamp === "string" &&
        Number.isFinite(Date.parse(event.timestamp)) &&
        (event.data === undefined ||
            (!!event.data && typeof event.data === "object" && !Array.isArray(event.data)))
    );
}

function webhookEventKey(payload: DiscordWebhookEventPayload): string {
    return `${payload.application_id}:${payload.event.type}:${payload.event.timestamp}:${JSON.stringify(payload.event.data)}`;
}

const DISCORD_WEBHOOK_RESPONSE_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
} as const;
