import { createHmac, timingSafeEqual } from "node:crypto";
import { TwitchError } from "./errors.js";
import type { TwitchConfig, TwitchEventSubMessage, TwitchIngestResult } from "./types.js";
import { parseEventSubMessage } from "./validation.js";

const HEADER_ID = "twitch-eventsub-message-id";
const HEADER_TYPE = "twitch-eventsub-message-type";
const HEADER_SIGNATURE = "twitch-eventsub-message-signature";
const HEADER_TIMESTAMP = "twitch-eventsub-message-timestamp";
const HEADER_SUBSCRIPTION_TYPE = "twitch-eventsub-subscription-type";
const HEADER_SUBSCRIPTION_VERSION = "twitch-eventsub-subscription-version";

export interface TwitchWebhookHandlerOptions {
    ingest(message: TwitchEventSubMessage): Promise<TwitchIngestResult>;
    now?: () => number;
}

/** EventSub Webhook 的 Fetch Request 边界：原始 body、HMAC、重放时窗、challenge 与结构化响应。 */
export class TwitchWebhookHandler {
    private readonly now: () => number;

    constructor(
        private readonly config: TwitchConfig,
        private readonly options: TwitchWebhookHandlerOptions,
    ) {
        this.now = options.now || Date.now;
    }

    async acceptHttp(request: Request): Promise<Response> {
        if (request.method !== "POST")
            return jsonResponse(405, { error: "method_not_allowed" }, { Allow: "POST" });
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json"))
            return jsonResponse(415, { error: "unsupported_media_type" });
        try {
            const raw = await readRequestBounded(
                request,
                this.config.max_response_bytes || 10_485_760,
            );
            const headers = requiredHeaders(request.headers);
            this.verify(headers, raw);
            const parsed = parseJson(raw);
            const envelope = parseEventSubMessage({
                metadata: {
                    message_id: headers.id,
                    message_type: headers.type,
                    message_timestamp: headers.timestamp,
                    subscription_type: request.headers.get(HEADER_SUBSCRIPTION_TYPE) || undefined,
                    subscription_version:
                        request.headers.get(HEADER_SUBSCRIPTION_VERSION) || undefined,
                },
                payload: parsed,
            });
            if (headers.type === "webhook_callback_verification") {
                return new Response(envelope.payload.challenge, {
                    status: 200,
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                });
            }
            const result = await this.options.ingest(envelope);
            return jsonResponse(204, undefined, {
                "X-OneBots-Duplicate": String(result.duplicate),
                "X-OneBots-Filtered": String(result.filtered),
            });
        } catch (error) {
            const twitchError = TwitchError.wrap(
                error,
                "Twitch Webhook 处理失败",
                "TWITCH_WEBHOOK_FAILED",
            );
            return jsonResponse(webhookStatus(twitchError), {
                error: twitchError.code,
                message: twitchError.message,
            });
        }
    }

    private verify(headers: WebhookHeaders, raw: Uint8Array): void {
        const timestamp = Date.parse(headers.timestamp);
        if (!Number.isFinite(timestamp))
            throw new TwitchError("Webhook timestamp 无效", {
                code: "TWITCH_WEBHOOK_TIMESTAMP_INVALID",
            });
        const tolerance = (this.config.webhook_tolerance_seconds || 600) * 1000;
        if (Math.abs(this.now() - timestamp) > tolerance)
            throw new TwitchError("Webhook 已超出允许时间窗", { code: "TWITCH_WEBHOOK_STALE" });
        const secret = this.config.webhook_secret;
        if (!secret)
            throw new TwitchError("未配置 webhook_secret", {
                code: "TWITCH_WEBHOOK_SECRET_MISSING",
            });
        const expected = `sha256=${createHmac("sha256", secret).update(headers.id).update(headers.timestamp).update(raw).digest("hex")}`;
        const received = Buffer.from(headers.signature);
        const calculated = Buffer.from(expected);
        if (received.length !== calculated.length || !timingSafeEqual(received, calculated)) {
            throw new TwitchError("Webhook HMAC 校验失败", {
                code: "TWITCH_WEBHOOK_SIGNATURE_INVALID",
            });
        }
    }
}

interface WebhookHeaders {
    id: string;
    type: string;
    timestamp: string;
    signature: string;
}

function requiredHeaders(headers: Headers): WebhookHeaders {
    const id = headers.get(HEADER_ID);
    const type = headers.get(HEADER_TYPE);
    const timestamp = headers.get(HEADER_TIMESTAMP);
    const signature = headers.get(HEADER_SIGNATURE);
    if (!id || !type || !timestamp || !signature)
        throw new TwitchError("Webhook 缺少必要 EventSub header", {
            code: "TWITCH_WEBHOOK_HEADERS_MISSING",
        });
    if (!["notification", "webhook_callback_verification", "revocation"].includes(type))
        throw new TwitchError(`Webhook message type 无效: ${type}`, {
            code: "TWITCH_WEBHOOK_TYPE_INVALID",
        });
    return { id, type, timestamp, signature };
}

async function readRequestBounded(request: Request, maxBytes: number): Promise<Uint8Array> {
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes)
        throw new TwitchError("Webhook body 超过大小上限", { code: "TWITCH_WEBHOOK_TOO_LARGE" });
    if (!request.body) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new TwitchError("Webhook body 超过大小上限", {
                    code: "TWITCH_WEBHOOK_TOO_LARGE",
                });
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function parseJson(raw: Uint8Array): unknown {
    try {
        return JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
        throw new TwitchError("Webhook body 不是有效 JSON", {
            code: "TWITCH_WEBHOOK_JSON_INVALID",
        });
    }
}

function webhookStatus(error: TwitchError): number {
    if (error.code === "TWITCH_WEBHOOK_TOO_LARGE") return 413;
    if (error.code === "TWITCH_WEBHOOK_SIGNATURE_INVALID" || error.code === "TWITCH_WEBHOOK_STALE")
        return 403;
    return 400;
}

function jsonResponse(status: number, body?: unknown, headers: HeadersInit = {}): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers:
            body === undefined
                ? headers
                : {
                      "Content-Type": "application/json; charset=utf-8",
                      ...Object.fromEntries(new Headers(headers)),
                  },
    });
}
