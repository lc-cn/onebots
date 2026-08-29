import {
    dispatchEvent,
    type WebhookRequest,
    type WebhookRequestHandler,
    type WebhookResponse,
    type WebhookServerAdapter,
} from "@tencent-connect/qqbot-nodejs/protocol";
import { ErrorCategory } from "onebots";
import { QQApiError } from "./errors.js";

export type QQRawEventListener = (eventType: string, data: unknown) => void | Promise<void>;

export interface QQHttpContext {
    request: { body?: unknown; rawBody?: unknown };
    headers: Record<string, unknown>;
    status: number;
    body: unknown;
    type: string;
    set(name: string, value: string): unknown;
}

/** 将 SDK Webhook 挂载到 OneBots 现有 HTTP Host，不创建额外监听端口。 */
export class QQWebhookHost implements WebhookServerAdapter {
    private handler?: WebhookRequestHandler;

    constructor(
        readonly path: string,
        private readonly accountId: string,
        private readonly onRawEvent: QQRawEventListener,
    ) {}

    async listen(_port: number, _path: string, handler: WebhookRequestHandler): Promise<void> {
        this.handler = handler;
    }

    close(): void {
        this.handler = undefined;
    }

    /** 最底层结构化入口，可供现有 HTTP Host 或测试直接投递原始请求。 */
    async ingest(request: WebhookRequest): Promise<WebhookResponse> {
        if (!this.handler) {
            throw new QQApiError("QQ Webhook 尚未启动", {
                code: "QQ_WEBHOOK_NOT_READY",
                category: ErrorCategory.RUNTIME,
            });
        }
        const response = await this.handler(request);
        if (response.status >= 200 && response.status < 300) {
            await this.dispatchRawEvent(request.body);
        }
        return response;
    }

    /** Koa/OneBots 路由入口，返回 SDK 生成的结构化 HTTP 响应。 */
    async acceptHttp(ctx: QQHttpContext): Promise<void> {
        try {
            const body = this.resolveRawBody(ctx.request.rawBody, ctx.request.body);
            const response = await this.ingest({
                body,
                headers: normalizeHeaders(ctx.headers),
            });
            ctx.status = response.status;
            for (const [name, value] of Object.entries(response.headers ?? {})) {
                ctx.set(name, value);
            }
            ctx.type = "application/json";
            ctx.body = response.body;
        } catch (error) {
            const wrapped = QQApiError.wrap(error, "QQ_WEBHOOK_ERROR");
            ctx.status = wrapped.code === "QQ_WEBHOOK_NOT_READY" ? 503 : 400;
            ctx.type = "application/json";
            ctx.body = JSON.stringify({ error: { code: wrapped.code, message: wrapped.message } });
        }
    }

    private resolveRawBody(rawBody: unknown, parsedBody: unknown): Buffer {
        if (Buffer.isBuffer(rawBody)) return rawBody;
        if (typeof rawBody === "string") return Buffer.from(rawBody);
        if (Buffer.isBuffer(parsedBody)) return parsedBody;
        if (typeof parsedBody === "string") return Buffer.from(parsedBody);
        throw QQApiError.invalid(
            "QQ Webhook 验签必须保留未经修改的 rawBody",
            "QQ_WEBHOOK_RAW_BODY_REQUIRED",
        );
    }

    private async dispatchRawEvent(body: Buffer): Promise<void> {
        let payload: { op?: unknown; t?: unknown; d?: unknown };
        try {
            payload = JSON.parse(body.toString("utf8")) as typeof payload;
        } catch {
            return;
        }
        if (payload.op !== 0 || typeof payload.t !== "string") return;
        const result = dispatchEvent(payload.t, payload.d, this.accountId);
        if (result.action === "raw") await this.onRawEvent(result.type, result.data);
    }
}

function normalizeHeaders(
    headers: Record<string, unknown>,
): Record<string, string | string[] | undefined> {
    const result: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string" || Array.isArray(value)) result[key] = value;
    }
    return result;
}
