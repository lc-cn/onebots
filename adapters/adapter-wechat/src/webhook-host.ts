import { randomBytes } from "node:crypto";
import type { WechatClient } from "./client.js";
import { wechatEventId } from "./client.js";
import { requireWechatWebhookConfig } from "./config.js";
import {
    decryptWechatPayload,
    encryptWechatPayload,
    signWechatMessage,
    verifyWechatSignature,
} from "./crypto.js";
import { WechatApiError } from "./errors.js";
import type {
    WechatConfig,
    WechatWebhookConfig,
    WechatWebhookRequest,
    WechatWebhookResponse,
} from "./types.js";
import {
    buildEncryptedReply,
    buildPassiveReply,
    parseIncomingMessage,
    parseWechatXml,
} from "./xml.js";

export interface WechatHttpContext {
    method: string;
    request: { body?: unknown; rawBody?: unknown };
    query: Record<string, unknown>;
    status: number;
    body: unknown;
    type: string;
}

/** 微信回调接入层：签名、解密、去重和被动回复都在框架无关的 ingest 中完成。 */
export class WechatWebhookHost {
    readonly path: string;
    private readonly config: WechatWebhookConfig;
    private readonly processed = new Set<string>();
    private readonly inFlight = new Map<string, Promise<WechatWebhookResponse>>();

    constructor(
        config: WechatConfig,
        private readonly client: WechatClient,
        private readonly errorListener: (error: WechatApiError) => void = () => undefined,
    ) {
        this.config = requireWechatWebhookConfig(config);
        this.path = this.config.webhook_path || `/wechat/${this.config.account_id}/webhook`;
        if (!/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u.test(this.path)) {
            throw new WechatApiError("webhook_path 必须是安全的绝对路径", {
                code: "WECHAT_INVALID_WEBHOOK_PATH",
            });
        }
    }

    async ingest(request: WechatWebhookRequest): Promise<WechatWebhookResponse> {
        return request.method === "GET"
            ? this.verifyEndpoint(request.query)
            : this.receiveMessage(request);
    }

    async acceptHttp(ctx: WechatHttpContext): Promise<void> {
        try {
            const method = ctx.method.toUpperCase();
            if (method !== "GET" && method !== "POST") {
                ctx.status = 405;
                ctx.type = "application/json";
                ctx.body = {
                    error: {
                        code: "WECHAT_METHOD_NOT_ALLOWED",
                        message: "微信公众号 Webhook 仅接受 GET 或 POST",
                    },
                };
                return;
            }
            const response = await this.ingest({
                method,
                query: ctx.query,
                body:
                    method === "GET"
                        ? undefined
                        : resolveRawBody(ctx.request.rawBody, ctx.request.body),
            });
            ctx.status = response.status;
            ctx.type = response.contentType || "text/plain";
            ctx.body = response.body;
        } catch (error) {
            const wrapped = WechatApiError.wrap(error, "WECHAT_WEBHOOK_ERROR");
            this.errorListener(wrapped);
            ctx.status = wrapped.status || 400;
            ctx.type = "application/json";
            ctx.body = { error: { code: wrapped.code, message: wrapped.message } };
        }
    }

    private verifyEndpoint(query: Readonly<Record<string, unknown>>): WechatWebhookResponse {
        const timestamp = queryString(query, "timestamp");
        const nonce = queryString(query, "nonce");
        const echo = queryString(query, "echostr");
        const messageSignature = optionalQueryString(query, "msg_signature");
        if (messageSignature || optionalQueryString(query, "encrypt_type") === "aes") {
            const key = this.requireAesKey();
            if (
                !verifyWechatSignature(
                    this.config.token,
                    messageSignature || "",
                    timestamp,
                    nonce,
                    echo,
                )
            ) {
                return forbidden();
            }
            return {
                status: 200,
                body: decryptWechatPayload(echo, key, this.config.app_id),
                contentType: "text/plain",
            };
        }
        if (
            !verifyWechatSignature(
                this.config.token,
                queryString(query, "signature"),
                timestamp,
                nonce,
            )
        ) {
            return forbidden();
        }
        return { status: 200, body: echo, contentType: "text/plain" };
    }

    private async receiveMessage(request: WechatWebhookRequest): Promise<WechatWebhookResponse> {
        const timestamp = queryString(request.query, "timestamp");
        const nonce = queryString(request.query, "nonce");
        const body = bodyString(request.body);
        const encrypted = optionalQueryString(request.query, "encrypt_type") === "aes";
        let xml = body;
        if (encrypted) {
            const encryptedBody = parseWechatXml(body).Encrypt;
            if (typeof encryptedBody !== "string" || !encryptedBody) return invalidBody();
            const signature = queryString(request.query, "msg_signature");
            if (
                !verifyWechatSignature(
                    this.config.token,
                    signature,
                    timestamp,
                    nonce,
                    encryptedBody,
                )
            ) {
                return forbidden();
            }
            xml = decryptWechatPayload(encryptedBody, this.requireAesKey(), this.config.app_id);
        } else if (
            !verifyWechatSignature(
                this.config.token,
                queryString(request.query, "signature"),
                timestamp,
                nonce,
            )
        ) {
            return forbidden();
        }
        const message = parseIncomingMessage(xml);
        message.RawXml = xml;
        if (encrypted) message.EncryptedXml = body;
        const eventId = wechatEventId(message);
        if (this.isDuplicate(eventId)) {
            return { status: 200, body: "success", contentType: "text/plain" };
        }
        const active = this.inFlight.get(eventId);
        if (active) return active;
        const delivery = this.deliverMessage(message, eventId, encrypted);
        this.inFlight.set(eventId, delivery);
        try {
            return await delivery;
        } finally {
            this.inFlight.delete(eventId);
        }
    }

    private async deliverMessage(
        message: ReturnType<typeof parseIncomingMessage>,
        eventId: string,
        encrypted: boolean,
    ): Promise<WechatWebhookResponse> {
        const reply = await this.client.ingest(message, {
            passiveReplyTimeoutMs: this.config.passive_reply_timeout_ms ?? 4_500,
        });
        if (!reply) {
            this.markProcessed(eventId);
            return { status: 200, body: "success", contentType: "text/plain" };
        }
        const replyXml = buildPassiveReply(message, reply);
        if (!encrypted) {
            this.markProcessed(eventId);
            return { status: 200, body: replyXml, contentType: "application/xml" };
        }
        const responseTimestamp = String(Math.floor(Date.now() / 1000));
        const responseNonce = randomBytes(8).toString("hex");
        const encryptedReply = encryptWechatPayload(
            replyXml,
            this.requireAesKey(),
            this.config.app_id,
        );
        const response = {
            status: 200,
            body: buildEncryptedReply(
                encryptedReply,
                signWechatMessage(
                    this.config.token,
                    responseTimestamp,
                    responseNonce,
                    encryptedReply,
                ),
                responseTimestamp,
                responseNonce,
            ),
            contentType: "application/xml",
        } satisfies WechatWebhookResponse;
        this.markProcessed(eventId);
        return response;
    }

    private requireAesKey(): string {
        if (!this.config.encoding_aes_key) {
            throw new WechatApiError("加密回调需要配置 encoding_aes_key", {
                code: "WECHAT_AES_KEY_REQUIRED",
                status: 400,
            });
        }
        return this.config.encoding_aes_key;
    }

    private isDuplicate(eventId: string): boolean {
        return this.config.deduplicate_webhooks !== false && this.processed.has(eventId);
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

function queryString(query: Readonly<Record<string, unknown>>, name: string): string {
    const value = optionalQueryString(query, name);
    if (!value) {
        throw new WechatApiError(`微信公众号 Webhook 缺少 ${name}`, {
            code: "WECHAT_INVALID_WEBHOOK_QUERY",
            status: 400,
        });
    }
    return value;
}

function optionalQueryString(
    query: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    const value = query[name];
    return Array.isArray(value)
        ? typeof value[0] === "string"
            ? value[0]
            : undefined
        : typeof value === "string"
          ? value
          : undefined;
}

function resolveRawBody(rawBody: unknown, body: unknown): string | Buffer {
    if (typeof rawBody === "string" || Buffer.isBuffer(rawBody)) return rawBody;
    if (typeof body === "string" || Buffer.isBuffer(body)) return body;
    throw new WechatApiError("微信公众号 Webhook 必须保留原始 XML 请求体", {
        code: "WECHAT_RAW_BODY_REQUIRED",
        status: 400,
    });
}

function bodyString(body: string | Buffer | undefined): string {
    if (typeof body === "string") return body;
    if (Buffer.isBuffer(body)) return body.toString("utf8");
    return invalidBody();
}

function forbidden(): WechatWebhookResponse {
    return { status: 403, body: "Invalid signature", contentType: "text/plain" };
}

function invalidBody(): never {
    throw new WechatApiError("微信公众号 Webhook 请求体无效", {
        code: "WECHAT_INVALID_WEBHOOK_BODY",
        status: 400,
    });
}
