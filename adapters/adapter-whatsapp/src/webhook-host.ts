import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppConfig,
    WhatsAppWebhookEvent,
    WhatsAppWebhookRequest,
    WhatsAppWebhookResponse,
} from "./types.js";

export interface WhatsAppHttpContext {
    request: { body?: unknown; rawBody?: unknown };
    query: Record<string, unknown>;
    headers: Record<string, unknown>;
    status: number;
    body: unknown;
    type: string;
}

export type WhatsAppWebhookListener = (event: WhatsAppWebhookEvent) => void | Promise<void>;

/** 安全接入 OneBots 现有 HTTP Host，并提供不依赖 Web 框架的底层 ingest。 */
export class WhatsAppWebhookHost {
    readonly path: string;
    private readonly processed = new Set<string>();

    constructor(
        private readonly config: WhatsAppConfig,
        private readonly listener: WhatsAppWebhookListener,
        private readonly errorListener: (error: WhatsAppApiError) => void = () => undefined,
    ) {
        this.path = config.webhook_path || `/whatsapp/${config.account_id}/webhook`;
        if (!this.path.startsWith("/")) {
            throw new WhatsAppApiError("WhatsApp webhook_path 必须以 / 开头", {
                code: "WHATSAPP_INVALID_WEBHOOK_PATH",
            });
        }
    }

    acceptVerification(query: Readonly<Record<string, unknown>>): WhatsAppWebhookResponse {
        const mode = query["hub.mode"];
        const token = query["hub.verify_token"];
        const challenge = query["hub.challenge"];
        if (
            mode === "subscribe" &&
            token === this.config.webhook_verify_token &&
            (typeof challenge === "string" || typeof challenge === "number")
        ) {
            return { status: 200, body: String(challenge), contentType: "text/plain" };
        }
        return {
            status: 403,
            body: { error: { code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED" } },
            contentType: "application/json",
        };
    }

    async ingest(request: WhatsAppWebhookRequest): Promise<WhatsAppWebhookResponse> {
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body);
        this.verifySignature(body, request.signature);
        const event = parseWebhook(body);
        const digest = createHash("sha256").update(body).digest("hex");
        if (this.isDuplicate(digest)) {
            return { status: 200, body: { ok: true, duplicate: true } };
        }
        await this.listener(event);
        this.markProcessed(digest);
        return { status: 200, body: { ok: true } };
    }

    async acceptHttp(ctx: WhatsAppHttpContext): Promise<void> {
        try {
            const rawBody = resolveRawBody(ctx.request.rawBody, ctx.request.body);
            const response = await this.ingest({
                body: rawBody,
                signature: header(ctx.headers, "x-hub-signature-256"),
            });
            ctx.status = response.status;
            ctx.type = response.contentType || "application/json";
            ctx.body = response.body;
        } catch (error) {
            const wrapped = WhatsAppApiError.wrap(error, "WHATSAPP_WEBHOOK_ERROR");
            this.errorListener(wrapped);
            ctx.status = wrapped.status || 400;
            ctx.type = "application/json";
            ctx.body = { error: { code: wrapped.code, message: wrapped.message } };
        }
    }

    private verifySignature(body: Buffer, signature: string | undefined): void {
        const expected = createHmac("sha256", this.config.app_secret).update(body).digest("hex");
        const actual = signature?.startsWith("sha256=") ? signature.slice(7) : "";
        const expectedBuffer = Buffer.from(expected, "hex");
        const actualBuffer = /^[a-f\d]{64}$/iu.test(actual)
            ? Buffer.from(actual, "hex")
            : Buffer.alloc(0);
        if (
            actualBuffer.length !== expectedBuffer.length ||
            !timingSafeEqual(actualBuffer, expectedBuffer)
        ) {
            throw new WhatsAppApiError("WhatsApp Webhook 签名验证失败", {
                code: "WHATSAPP_INVALID_SIGNATURE",
                status: 401,
            });
        }
    }

    private isDuplicate(digest: string): boolean {
        return this.config.deduplicate_webhooks !== false && this.processed.has(digest);
    }

    private markProcessed(digest: string): void {
        if (this.config.deduplicate_webhooks === false) return;
        this.processed.add(digest);
        const limit = Math.max(100, this.config.webhook_deduplication_limit || 10_000);
        while (this.processed.size > limit) {
            const oldest = this.processed.values().next().value;
            if (typeof oldest !== "string") break;
            this.processed.delete(oldest);
        }
    }
}

function parseWebhook(body: Buffer): WhatsAppWebhookEvent {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.toString("utf8")) as unknown;
    } catch (error) {
        throw new WhatsAppApiError("WhatsApp Webhook 请求体不是有效 JSON", {
            code: "WHATSAPP_INVALID_WEBHOOK_BODY",
            status: 400,
            cause: error,
        });
    }
    if (!isWebhookEvent(parsed)) {
        throw new WhatsAppApiError("WhatsApp Webhook 请求体结构无效", {
            code: "WHATSAPP_INVALID_WEBHOOK_BODY",
            status: 400,
        });
    }
    return parsed;
}

function isWebhookEvent(value: unknown): value is WhatsAppWebhookEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        record.object === "whatsapp_business_account" &&
        Array.isArray(record.entry) &&
        record.entry.every(entry => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
            const item = entry as Record<string, unknown>;
            return (
                typeof item.id === "string" &&
                Array.isArray(item.changes) &&
                item.changes.every(change => {
                    if (!change || typeof change !== "object" || Array.isArray(change)) {
                        return false;
                    }
                    const event = change as Record<string, unknown>;
                    return (
                        typeof event.field === "string" &&
                        !!event.value &&
                        typeof event.value === "object" &&
                        !Array.isArray(event.value)
                    );
                })
            );
        })
    );
}

function resolveRawBody(rawBody: unknown, body: unknown): string | Buffer {
    if (Buffer.isBuffer(rawBody) || typeof rawBody === "string") return rawBody;
    if (Buffer.isBuffer(body) || typeof body === "string") return body;
    throw new WhatsAppApiError("WhatsApp Webhook 验签必须保留未经修改的 rawBody", {
        code: "WHATSAPP_RAW_BODY_REQUIRED",
        status: 400,
    });
}

function header(headers: Record<string, unknown>, name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
}
