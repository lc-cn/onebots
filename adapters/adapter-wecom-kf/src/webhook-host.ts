import {
    decryptWechatCallbackFor,
    extractWechatEncryptedPayload,
    parseWechatXml,
    verifyWechatCallbackSignature,
} from "onebots";
import type { WeComKfClient } from "./client.js";
import { WeComKfError } from "./errors.js";
import type {
    KfCallbackEvent,
    KfWebhookRequest,
    KfWebhookResponse,
    WeComKfConfig,
} from "./types.js";

export interface WeComKfHttpContext {
    method: string;
    request: { body?: unknown; rawBody?: unknown };
    query: Record<string, unknown>;
    status: number;
    body: unknown;
    type: string;
}

/** 微信客服回调接入层：只处理官方加密 XML，不依赖具体 HTTP 框架。 */
export class WeComKfWebhookHost {
    readonly path: string;
    private readonly token: string;
    private readonly encodingAesKey: string;

    constructor(
        private readonly config: WeComKfConfig,
        private readonly client: WeComKfClient,
        private readonly errorListener: (error: WeComKfError) => void = () => undefined,
    ) {
        if (!config.token || !config.encoding_aes_key) {
            throw new WeComKfError("微信客服回调需要 token 和 encoding_aes_key", {
                code: "WECOM_KF_WEBHOOK_CONFIG_REQUIRED",
            });
        }
        this.token = config.token;
        this.encodingAesKey = config.encoding_aes_key;
        this.path = config.webhook_path || `/wecom-kf/${config.account_id}/webhook`;
        if (!/^\/(?!\/)(?:[^?#\u0000-\u001f\u007f])*$/u.test(this.path)) {
            throw new WeComKfError("webhook_path 必须是安全的绝对路径", {
                code: "WECOM_KF_INVALID_WEBHOOK_PATH",
            });
        }
    }

    /** 接收框架无关的 GET/POST 回调描述并返回结构化 HTTP 响应。 */
    async ingest(request: KfWebhookRequest): Promise<KfWebhookResponse> {
        return request.method === "GET"
            ? this.verifyEndpoint(request.query)
            : this.receiveCallback(request);
    }

    /** 将结构化处理结果写回已有 Koa 风格 HTTP Host 的上下文。 */
    async acceptHttp(ctx: WeComKfHttpContext): Promise<void> {
        try {
            const method = ctx.method.toUpperCase();
            if (method !== "GET" && method !== "POST") {
                ctx.status = 405;
                ctx.type = "application/json";
                ctx.body = {
                    error: {
                        code: "WECOM_KF_METHOD_NOT_ALLOWED",
                        message: "微信客服 Webhook 仅接受 GET 或 POST",
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
            const wrapped = WeComKfError.wrap(error, "WECOM_KF_WEBHOOK_ERROR");
            this.reportError(wrapped);
            ctx.status = wrapped.status || 500;
            ctx.type = "application/json";
            ctx.body = { error: { code: wrapped.code, message: wrapped.message } };
        }
    }

    private verifyEndpoint(query: Readonly<Record<string, unknown>>): KfWebhookResponse {
        const timestamp = queryString(query, "timestamp");
        const nonce = queryString(query, "nonce");
        const echo = queryString(query, "echostr");
        if (
            !verifyWechatCallbackSignature(
                this.token,
                queryString(query, "msg_signature"),
                timestamp,
                nonce,
                echo,
            )
        )
            return forbidden();
        return {
            status: 200,
            body: decryptPayload(echo, this.encodingAesKey, this.config.corp_id),
            contentType: "text/plain",
        };
    }

    private async receiveCallback(request: KfWebhookRequest): Promise<KfWebhookResponse> {
        const encryptedXml = bodyString(request.body);
        const encrypted = extractWechatEncryptedPayload(encryptedXml);
        if (!encrypted)
            throw new WeComKfError("微信客服回调缺少 Encrypt", {
                code: "WECOM_KF_INVALID_WEBHOOK_BODY",
                status: 400,
            });
        const timestamp = queryString(request.query, "timestamp");
        const nonce = queryString(request.query, "nonce");
        if (
            !verifyWechatCallbackSignature(
                this.token,
                queryString(request.query, "msg_signature"),
                timestamp,
                nonce,
                encrypted,
            )
        )
            return forbidden();
        const rawXml = decryptPayload(encrypted, this.encodingAesKey, this.config.corp_id);
        const event = parseCallback(rawXml, encryptedXml);
        if (event.Event === "kf_msg_or_event") {
            if (!event.Token || !event.OpenKfId)
                throw new WeComKfError("kf_msg_or_event 缺少 Token 或 OpenKfId", {
                    code: "WECOM_KF_INVALID_CALLBACK",
                    status: 400,
                });
            this.dispatchCallback(event);
            // 企业微信要求快速确认回调；耗时分页进入 Client 的串行同步队列。
            void this.client
                .synchronize(event.OpenKfId, event.Token)
                .catch(error => this.reportError(WeComKfError.wrap(error, "WECOM_KF_SYNC_ERROR")));
        } else {
            this.dispatchCallback(event);
        }
        return { status: 200, body: "success", contentType: "text/plain" };
    }

    private dispatchCallback(event: KfCallbackEvent): void {
        try {
            this.client.ingestCallback(event);
        } catch (error) {
            throw WeComKfError.wrap(error, "WECOM_KF_CALLBACK_DISPATCH_ERROR");
        }
    }

    private reportError(error: WeComKfError): void {
        try {
            this.errorListener(error);
        } catch {
            // 错误观察器不得破坏 Webhook ACK 或制造未处理的后台 Promise。
        }
    }
}

function decryptPayload(encrypted: string, encodingAesKey: string, corpId: string): string {
    try {
        return decryptWechatCallbackFor(encrypted, encodingAesKey, corpId);
    } catch (error) {
        throw new WeComKfError("微信客服回调解密或 CorpID 校验失败", {
            code: "WECOM_KF_INVALID_ENCRYPTED_PAYLOAD",
            status: 400,
            cause: error,
        });
    }
}

function parseCallback(rawXml: string, encryptedXml: string): KfCallbackEvent {
    const value = parseWechatXml(rawXml);
    if (value.MsgType !== "event" || typeof value.Event !== "string" || !value.Event) {
        throw new WeComKfError("微信客服回调不是有效事件", {
            code: "WECOM_KF_INVALID_CALLBACK",
            status: 400,
        });
    }
    return {
        ...value,
        MsgType: "event",
        Event: value.Event,
        RawXml: rawXml,
        EncryptedXml: encryptedXml,
    } as KfCallbackEvent;
}

function queryString(query: Readonly<Record<string, unknown>>, name: string): string {
    const value = query[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== "string" || !first)
        throw new WeComKfError(`微信客服 Webhook 缺少 ${name}`, {
            code: "WECOM_KF_INVALID_WEBHOOK_QUERY",
            status: 400,
        });
    return first;
}

function resolveRawBody(rawBody: unknown, body: unknown): string | Buffer {
    if (typeof rawBody === "string" || Buffer.isBuffer(rawBody)) return rawBody;
    if (typeof body === "string" || Buffer.isBuffer(body)) return body;
    throw new WeComKfError("微信客服 Webhook 必须保留原始 XML 请求体", {
        code: "WECOM_KF_RAW_BODY_REQUIRED",
        status: 400,
    });
}

function bodyString(body: string | Buffer | undefined): string {
    if (typeof body === "string") return body;
    if (Buffer.isBuffer(body)) return body.toString("utf8");
    throw new WeComKfError("微信客服 Webhook 请求体为空", {
        code: "WECOM_KF_INVALID_WEBHOOK_BODY",
        status: 400,
    });
}

function forbidden(): KfWebhookResponse {
    return { status: 403, body: "消息签名无效", contentType: "text/plain" };
}
