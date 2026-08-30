import { createHash } from "node:crypto";
import {
    dispatchEvent,
    type DispatchResult,
    type WebhookRequest,
    type WebhookRequestHandler,
    type WebhookResponse,
    type WebhookServerAdapter,
} from "@tencent-connect/qqbot-nodejs/protocol";
import { ErrorCategory, RecentEventDeduplicator } from "onebots";
import { QQApiError } from "./errors.js";

export type QQWebhookDispatchResult = Extract<
    DispatchResult,
    { action: "message" | "interaction" | "raw" }
>;
export type QQWebhookDispatchListener = (result: QQWebhookDispatchResult) => void | Promise<void>;

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
    private readonly receivedEvents = new RecentEventDeduplicator<string>();

    constructor(
        readonly path: string,
        private readonly accountId: string,
        private readonly onDispatch: QQWebhookDispatchListener,
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
            await this.dispatchVerifiedEvent(request.body);
        }
        return response;
    }

    /** Fetch / WinterCG Host 入口，返回 SDK 生成的结构化响应。 */
    async acceptHttp(request: Request): Promise<Response>;
    /** Koa/OneBots 路由入口，写入 SDK 生成的结构化响应。 */
    async acceptHttp(ctx: QQHttpContext): Promise<void>;
    async acceptHttp(request: Request | QQHttpContext): Promise<Response | void> {
        if (isStandardRequest(request)) return this.acceptFetchRequest(request);
        await this.acceptKoaContext(request);
    }

    private async acceptFetchRequest(request: Request): Promise<Response> {
        if (request.method !== "POST") {
            return Response.json(
                { error: { code: "QQ_METHOD_NOT_ALLOWED", message: "Method Not Allowed" } },
                { status: 405, headers: { Allow: "POST" } },
            );
        }
        try {
            const response = await this.ingest({
                body: Buffer.from(await request.arrayBuffer()),
                headers: Object.fromEntries(request.headers),
            });
            return new Response(response.body, {
                status: response.status,
                headers: responseHeaders(response.headers),
            });
        } catch (error) {
            const wrapped = QQApiError.wrap(error, "QQ_WEBHOOK_ERROR");
            return Response.json(
                { error: { code: wrapped.code, message: wrapped.message } },
                { status: webhookErrorStatus(wrapped) },
            );
        }
    }

    private async acceptKoaContext(ctx: QQHttpContext): Promise<void> {
        try {
            const response = await this.ingest({
                body: this.resolveRawBody(ctx.request.rawBody, ctx.request.body),
                headers: normalizeHeaders(ctx.headers),
            });
            ctx.status = response.status;
            for (const [name, value] of Object.entries(response.headers ?? {}))
                ctx.set(name, value);
            ctx.type = "application/json";
            ctx.body = response.body;
        } catch (error) {
            const wrapped = QQApiError.wrap(error, "QQ_WEBHOOK_ERROR");
            ctx.status = webhookErrorStatus(wrapped);
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

    /** SDK 验签成功后同步补充分发；成功前不确认，避免业务失败被 HTTP 200 吞掉。 */
    private async dispatchVerifiedEvent(body: Buffer): Promise<void> {
        let payload: { op?: unknown; t?: unknown; d?: unknown };
        try {
            payload = JSON.parse(body.toString("utf8")) as typeof payload;
        } catch {
            return;
        }
        if (payload.op !== 0 || typeof payload.t !== "string") return;
        const eventKey = createHash("sha256").update(body).digest("base64url");
        if (this.receivedEvents.has(eventKey)) return;
        const result = dispatchEvent(payload.t, payload.d, this.accountId);
        if (
            result.action === "message" ||
            result.action === "interaction" ||
            result.action === "raw"
        ) {
            await this.onDispatch(result);
        }
        this.receivedEvents.commit(eventKey);
    }
}

function isStandardRequest(value: Request | QQHttpContext): value is Request {
    return (
        typeof (value as Request).method === "string" &&
        typeof (value as Request).arrayBuffer === "function" &&
        typeof (value as Request).headers?.get === "function"
    );
}

function responseHeaders(headers: Record<string, string> | undefined): Headers {
    const result = new Headers(headers);
    if (!result.has("content-type")) result.set("content-type", "application/json");
    return result;
}

function webhookErrorStatus(error: QQApiError): number {
    if (error.code === "QQ_WEBHOOK_NOT_READY") return 503;
    if (error.category === ErrorCategory.VALIDATION || error.category === ErrorCategory.PROTOCOL) {
        return 400;
    }
    return 500;
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
