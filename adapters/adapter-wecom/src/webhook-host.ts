import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import type { WeComConfig, WeComWebhookRequest, WeComWebhookResponse } from "./types.js";

export interface WeComHttpContext {
    method: string;
    request: { body?: unknown; rawBody?: unknown };
    query: Record<string, unknown>;
    status: number;
    body: unknown;
    type: string;
}

/** Koa 与 WeComClient 标准接入接口之间的薄桥接，不持有解密或去重状态。 */
export class WeComWebhookHost {
    readonly path: string;

    constructor(
        config: WeComConfig,
        private readonly client: WeComClient,
        private readonly errorListener: (error: WeComApiError) => void = () => undefined,
    ) {
        this.path = config.webhook_path || `/wecom/${config.account_id}/webhook`;
        if (!/^\/(?!\/)(?:[^?#\u0000-\u001f\u007f])*$/u.test(this.path)) {
            throw new WeComApiError("webhook_path 必须是安全的绝对路径", {
                code: "WECOM_INVALID_WEBHOOK_PATH",
            });
        }
    }

    async ingest(request: WeComWebhookRequest): Promise<WeComWebhookResponse> {
        return this.client.ingestHttp(request);
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
}

function resolveRawBody(rawBody: unknown, body: unknown): string | Buffer {
    if (typeof rawBody === "string" || Buffer.isBuffer(rawBody)) return rawBody;
    if (typeof body === "string" || Buffer.isBuffer(body)) return body;
    throw new WeComApiError("企业微信 Webhook 必须保留原始 XML 请求体", {
        code: "WECOM_RAW_BODY_REQUIRED",
        status: 400,
    });
}

export { weComEventId } from "./webhook.js";
