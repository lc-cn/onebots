import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppConfig,
    WhatsAppIngestResult,
    WhatsAppWebhookRequest,
    WhatsAppWebhookResponse,
} from "./types.js";
import { resolveWhatsAppVerification } from "./webhook.js";

export interface WhatsAppHttpContext {
    request: { body?: unknown; rawBody?: unknown };
    query: Record<string, unknown>;
    headers: Record<string, unknown>;
    status: number;
    body: unknown;
    type: string;
}

/** Koa 与 WhatsAppClient 标准接入接口之间的薄桥接，不持有事件或去重状态。 */
export class WhatsAppWebhookHost {
    readonly path: string;

    constructor(
        private readonly config: WhatsAppConfig,
        private readonly client: WhatsAppClient,
        private readonly errorListener: (error: WhatsAppApiError) => void = () => undefined,
        private readonly eventIngestor: (
            request: WhatsAppWebhookRequest,
        ) => Promise<WhatsAppIngestResult> = request =>
            this.client.ingestHttp(request.body, request.signature),
    ) {
        this.path = config.webhook_path || `/whatsapp/${config.account_id}/webhook`;
        if (!/^\/(?!\/)(?:[^?#\u0000-\u001f\u007f])*$/u.test(this.path)) {
            throw new WhatsAppApiError("WhatsApp webhook_path 必须是安全的绝对路径", {
                code: "WHATSAPP_INVALID_WEBHOOK_PATH",
            });
        }
    }

    acceptVerification(query: Readonly<Record<string, unknown>>): WhatsAppWebhookResponse {
        return resolveWhatsAppVerification(query, this.config.webhook_verify_token);
    }

    async ingest(request: WhatsAppWebhookRequest): Promise<WhatsAppWebhookResponse> {
        const result = await this.eventIngestor(request);
        return {
            status: 200,
            body: {
                ok: true,
                accepted: result.accepted,
                duplicate: result.duplicate,
                changes: result.changes,
                ignored_changes: result.ignoredChanges,
            },
        };
    }

    async acceptHttp(ctx: WhatsAppHttpContext): Promise<void> {
        try {
            const response = await this.ingest({
                body: resolveRawBody(ctx.request.rawBody, ctx.request.body),
                signature: header(ctx.headers, "x-hub-signature-256"),
            });
            ctx.status = response.status;
            ctx.type = response.contentType || "application/json";
            ctx.body = response.body;
        } catch (error) {
            const wrapped = WhatsAppApiError.wrap(error, "WHATSAPP_WEBHOOK_ERROR");
            this.errorListener(wrapped);
            ctx.status = wrapped.status || 500;
            ctx.type = "application/json";
            ctx.body = { error: { code: wrapped.code, message: wrapped.message } };
        }
    }
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
