import { createHash } from "node:crypto";
import {
    decryptWechatCallbackFor,
    extractWechatEncryptedPayload,
    parseWechatXml,
    verifyWechatCallbackSignature,
} from "onebots";
import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import type {
    WeComConfig,
    WeComEvent,
    WeComWebhookRequest,
    WeComWebhookResponse,
} from "./types.js";

export interface WeComHttpContext {
    method: string;
    request: { body?: unknown; rawBody?: unknown };
    query: Record<string, unknown>;
    status: number;
    body: unknown;
    type: string;
}

/** 企业微信加密回调接入层，不依赖具体 HTTP 框架。 */
export class WeComWebhookHost {
    readonly path: string;
    private readonly processed = new Set<string>();

    constructor(
        private readonly config: WeComConfig,
        private readonly client: WeComClient,
        private readonly errorListener: (error: WeComApiError) => void = () => undefined,
    ) {
        this.path = config.webhook_path || `/wecom/${config.account_id}/webhook`;
        if (!this.path.startsWith("/"))
            throw new WeComApiError("webhook_path 必须以 / 开头", {
                code: "WECOM_INVALID_WEBHOOK_PATH",
            });
    }

    async ingest(request: WeComWebhookRequest): Promise<WeComWebhookResponse> {
        return request.method === "GET"
            ? this.verifyEndpoint(request.query)
            : this.receiveEvent(request);
    }

    async acceptHttp(ctx: WeComHttpContext): Promise<void> {
        try {
            const method = ctx.method.toUpperCase();
            if (method !== "GET" && method !== "POST") {
                ctx.status = 405;
                ctx.type = "application/json";
                ctx.body = {
                    error: {
                        code: "WECOM_METHOD_NOT_ALLOWED",
                        message: "企业微信 Webhook 仅接受 GET 或 POST",
                    },
                };
                return;
            }
            const response = await this.ingest({
                method,
                query: ctx.query,
                body:
                    method === "POST"
                        ? resolveRawBody(ctx.request.rawBody, ctx.request.body)
                        : undefined,
            });
            ctx.status = response.status;
            ctx.type = response.contentType || "text/plain";
            ctx.body = response.body;
        } catch (error) {
            const wrapped = WeComApiError.wrap(error, "WECOM_WEBHOOK_ERROR");
            this.errorListener(wrapped);
            ctx.status = wrapped.status || 400;
            ctx.type = "application/json";
            ctx.body = { error: { code: wrapped.code, message: wrapped.message } };
        }
    }

    private verifyEndpoint(query: Readonly<Record<string, unknown>>): WeComWebhookResponse {
        const timestamp = queryString(query, "timestamp");
        const nonce = queryString(query, "nonce");
        const echo = queryString(query, "echostr");
        if (
            !verifyWechatCallbackSignature(
                this.config.token,
                queryString(query, "msg_signature"),
                timestamp,
                nonce,
                echo,
            )
        )
            return forbidden();
        return {
            status: 200,
            body: decryptWechatCallbackFor(echo, this.config.encoding_aes_key, this.config.corp_id),
            contentType: "text/plain",
        };
    }

    private receiveEvent(request: WeComWebhookRequest): WeComWebhookResponse {
        const body = bodyString(request.body);
        const encrypted = extractWechatEncryptedPayload(body);
        if (!encrypted)
            throw new WeComApiError("企业微信回调缺少 Encrypt", {
                code: "WECOM_INVALID_WEBHOOK_BODY",
                status: 400,
            });
        const timestamp = queryString(request.query, "timestamp");
        const nonce = queryString(request.query, "nonce");
        if (
            !verifyWechatCallbackSignature(
                this.config.token,
                queryString(request.query, "msg_signature"),
                timestamp,
                nonce,
                encrypted,
            )
        )
            return forbidden();
        const xml = decryptWechatCallbackFor(
            encrypted,
            this.config.encoding_aes_key,
            this.config.corp_id,
        );
        const event = parseEvent(xml, body);
        const eventId = weComEventId(event);
        if (this.config.deduplicate_webhooks !== false && this.processed.has(eventId)) {
            return { status: 200, body: "success", contentType: "text/plain" };
        }
        this.client.ingest(event);
        this.markProcessed(eventId);
        return { status: 200, body: "success", contentType: "text/plain" };
    }

    private markProcessed(eventId: string): void {
        if (this.config.deduplicate_webhooks === false) return;
        this.processed.add(eventId);
        const limit = Math.max(100, this.config.webhook_deduplication_limit || 10_000);
        while (this.processed.size > limit) {
            const oldest = this.processed.values().next().value;
            if (typeof oldest !== "string") break;
            this.processed.delete(oldest);
        }
    }
}

export function weComEventId(event: WeComEvent): string {
    if (event.MsgId) return event.MsgId;
    const identity = [
        event.FromUserName,
        event.CreateTime,
        event.Event || event.MsgType,
        event.ChangeType,
        event.UserID,
    ]
        .filter(Boolean)
        .join(":");
    if (identity) return identity;
    return createHash("sha256")
        .update(event.RawXml || JSON.stringify(event))
        .digest("hex");
}

function parseEvent(xml: string, encryptedXml: string): WeComEvent {
    const value = parseWechatXml(xml) as WeComEvent;
    if (typeof value.MsgType !== "string") {
        throw new WeComApiError("企业微信回调缺少 MsgType", {
            code: "WECOM_INVALID_WEBHOOK_BODY",
            status: 400,
        });
    }
    value.RawXml = xml;
    value.EncryptedXml = encryptedXml;
    return value;
}

function queryString(query: Readonly<Record<string, unknown>>, name: string): string {
    const value = query[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== "string" || !first)
        throw new WeComApiError(`企业微信 Webhook 缺少 ${name}`, {
            code: "WECOM_INVALID_WEBHOOK_QUERY",
            status: 400,
        });
    return first;
}

function resolveRawBody(rawBody: unknown, body: unknown): string | Buffer {
    if (typeof rawBody === "string" || Buffer.isBuffer(rawBody)) return rawBody;
    if (typeof body === "string" || Buffer.isBuffer(body)) return body;
    throw new WeComApiError("企业微信 Webhook 必须保留原始 XML 请求体", {
        code: "WECOM_RAW_BODY_REQUIRED",
        status: 400,
    });
}

function bodyString(body: string | Buffer | undefined): string {
    if (typeof body === "string") return body;
    if (Buffer.isBuffer(body)) return body.toString("utf8");
    throw new WeComApiError("企业微信 Webhook 请求体为空", {
        code: "WECOM_INVALID_WEBHOOK_BODY",
        status: 400,
    });
}

function forbidden(): WeComWebhookResponse {
    return { status: 403, body: "Invalid msg_signature", contentType: "text/plain" };
}
