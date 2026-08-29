import { HTTPFetchError, JSONParseError, SignatureValidationFailed } from "@line/bot-sdk";

export interface LineApiErrorOptions {
    code?: string;
    status?: number;
    details?: unknown;
    cause?: unknown;
}

/** 对外稳定的 LINE 协议错误，保留 HTTP 状态与官方错误体。 */
export class LineApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly details?: unknown;

    constructor(message: string, options: LineApiErrorOptions = {}) {
        super(message, { cause: options.cause });
        this.name = "LineApiError";
        this.code = options.code || "LINE_API_ERROR";
        this.status = options.status;
        this.details = options.details;
    }

    static wrap(error: unknown, fallbackCode = "LINE_API_ERROR"): LineApiError {
        if (error instanceof LineApiError) return error;
        if (error instanceof SignatureValidationFailed) {
            return new LineApiError("LINE Webhook 签名验证失败", {
                code: "LINE_INVALID_SIGNATURE",
                status: 401,
                cause: error,
            });
        }
        if (error instanceof JSONParseError) {
            return new LineApiError("LINE Webhook 请求体不是有效 JSON", {
                code: "LINE_INVALID_WEBHOOK_BODY",
                status: 400,
                cause: error,
            });
        }
        if (error instanceof HTTPFetchError) {
            return new LineApiError(`LINE API 请求失败: ${error.status} ${error.statusText}`, {
                code: parseLineErrorCode(error.body) || fallbackCode,
                status: error.status,
                details: parseJson(error.body),
                cause: error,
            });
        }
        return new LineApiError(error instanceof Error ? error.message : String(error), {
            code: fallbackCode,
            cause: error,
        });
    }
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}

function parseLineErrorCode(value: string): string | undefined {
    const parsed = parseJson(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const message = (parsed as Record<string, unknown>).message;
    return typeof message === "string" && message ? `LINE_${normalizeCode(message)}` : undefined;
}

function normalizeCode(value: string): string {
    return value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, 64);
}
