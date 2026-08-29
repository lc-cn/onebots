import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppWebhookEvent, WhatsAppWebhookResponse } from "./types.js";

/** 解析并验证 Cloud API 的 CallbackRequest 外层结构。 */
export function parseWhatsAppWebhookBody(body: Buffer): WhatsAppWebhookEvent {
    try {
        return parseWhatsAppWebhook(JSON.parse(body.toString("utf8")) as unknown);
    } catch (error) {
        if (error instanceof WhatsAppApiError) throw error;
        throw new WhatsAppApiError("WhatsApp Webhook 请求体不是有效 JSON", {
            code: "WHATSAPP_INVALID_WEBHOOK_BODY",
            status: 400,
            cause: error,
        });
    }
}

/** 验证手动接入的原始事件，未知 change 字段仍会完整保留。 */
export function parseWhatsAppWebhook(value: unknown): WhatsAppWebhookEvent {
    if (!isWhatsAppWebhookEvent(value)) {
        throw new WhatsAppApiError("WhatsApp Webhook 请求体结构无效", {
            code: "WHATSAPP_INVALID_WEBHOOK_BODY",
            status: 400,
        });
    }
    return value;
}

/** 使用 Meta X-Hub-Signature-256 规则验证未经修改的请求体。 */
export function verifyWhatsAppSignature(
    body: Buffer,
    signature: string | undefined,
    appSecret: string | undefined,
): void {
    if (!appSecret) {
        throw new WhatsAppApiError("WhatsApp Webhook 验签需要 app_secret", {
            code: "WHATSAPP_APP_SECRET_REQUIRED",
        });
    }
    const expected = createHmac("sha256", appSecret).update(body).digest("hex");
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

export function digestWhatsAppPayload(value: Buffer | WhatsAppWebhookEvent): string {
    return createHash("sha256")
        .update(Buffer.isBuffer(value) ? value : JSON.stringify(value))
        .digest("hex");
}

export function acceptWhatsAppVerification(requestUrl: string, verifyToken?: string): Response {
    const result = resolveWhatsAppVerification(
        Object.fromEntries(new URL(requestUrl).searchParams),
        verifyToken,
    );
    if (typeof result.body === "string") {
        return new Response(result.body, {
            status: result.status,
            headers: { "Content-Type": result.contentType || "text/plain" },
        });
    }
    return Response.json(result.body, { status: result.status });
}

/** Web 框架桥接与标准 Request 共用的 Meta 订阅验证规则。 */
export function resolveWhatsAppVerification(
    query: Readonly<Record<string, unknown>>,
    verifyToken?: string,
): WhatsAppWebhookResponse {
    const challenge = query["hub.challenge"];
    if (
        query["hub.mode"] === "subscribe" &&
        query["hub.verify_token"] === verifyToken &&
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

export function whatsAppErrorResponse(error: WhatsAppApiError): Response {
    return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status || 500 },
    );
}

function isWhatsAppWebhookEvent(value: unknown): value is WhatsAppWebhookEvent {
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
