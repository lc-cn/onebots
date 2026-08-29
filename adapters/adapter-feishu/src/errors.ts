import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface FeishuErrorOptions {
    code: string;
    operation?: string;
    status?: number;
    platformCode?: number;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** 飞书/Lark 的结构化 SDK 错误。 */
export class FeishuError extends OneBotsError {
    readonly operation?: string;
    readonly status?: number;
    readonly platformCode?: number;
    readonly details?: unknown;

    constructor(message: string, options: FeishuErrorOptions) {
        super(message, {
            code: options.code,
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.operation ? { operation: options.operation } : {}),
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.platformCode === undefined
                    ? {}
                    : { platform_code: options.platformCode }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "FeishuError";
        this.operation = options.operation;
        this.status = options.status;
        this.platformCode = options.platformCode;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, operation?: string): FeishuError {
        if (error instanceof FeishuError) return error;
        return new FeishuError(error instanceof Error ? error.message : String(error), {
            code,
            operation,
            cause: error,
        });
    }
}

export function invalidFeishuParam(message: string, details?: unknown): FeishuError {
    return new FeishuError(message, {
        code: "FEISHU_INVALID_PARAM",
        category: ErrorCategory.VALIDATION,
        details,
    });
}

function categoryFor(options: FeishuErrorOptions): ErrorCategory {
    if (options.status === 400 || options.status === 422) return ErrorCategory.VALIDATION;
    if (options.status === 404) return ErrorCategory.RESOURCE;
    if (options.status !== undefined && options.status >= 500) return ErrorCategory.NETWORK;
    if (options.code.includes("NETWORK")) return ErrorCategory.NETWORK;
    if (
        options.code.includes("INVALID_PARAM") ||
        options.code.includes("UNSAFE") ||
        options.code.includes("ENDPOINT")
    ) {
        return ErrorCategory.VALIDATION;
    }
    if (
        options.code.includes("INVALID_RESPONSE") ||
        options.code.includes("INVALID_EVENT") ||
        options.code.includes("WEBHOOK")
    ) {
        return ErrorCategory.PROTOCOL;
    }
    if (options.code.includes("NOT_FOUND") || options.code === "FEISHU_MESSAGE_MISSING") {
        return ErrorCategory.RESOURCE;
    }
    if (options.code.includes("START_FAILED") || options.code.includes("LISTENER_FAILED")) {
        return ErrorCategory.RUNTIME;
    }
    return ErrorCategory.ADAPTER;
}
