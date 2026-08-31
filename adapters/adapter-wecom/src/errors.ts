import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface WeComApiErrorOptions {
    code?: string;
    status?: number;
    path?: string;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** 企业微信 API 与回调结构化错误。 */
export class WeComApiError extends OneBotsError {
    readonly status?: number;
    readonly path?: string;
    readonly details?: unknown;

    constructor(message: string, options: WeComApiErrorOptions = {}) {
        super(message, {
            code: options.code || "WECOM_API_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.path === undefined ? {} : { path: options.path }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "WeComApiError";
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
    }

    static wrap(error: unknown, code = "WECOM_API_ERROR"): WeComApiError {
        if (error instanceof WeComApiError) return error;
        return new WeComApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}

function categoryFor(options: WeComApiErrorOptions): ErrorCategory {
    if (options.status === 400 || options.status === 422) return ErrorCategory.VALIDATION;
    if (options.status === 401 || options.status === 403) return ErrorCategory.CONFIG;
    if (options.status === 404) return ErrorCategory.RESOURCE;
    if (options.status === 429 || (options.status ?? 0) >= 500) return ErrorCategory.NETWORK;
    if (options.code?.includes("SIGNATURE") || options.code?.includes("CONFIG")) {
        return ErrorCategory.CONFIG;
    }
    if (
        options.code?.includes("INVALID") ||
        options.code?.includes("REQUIRED") ||
        options.code?.includes("EMPTY")
    ) {
        return ErrorCategory.VALIDATION;
    }
    if (options.code?.includes("WEBHOOK")) return ErrorCategory.PROTOCOL;
    if (options.code?.includes("NETWORK") || options.code?.includes("HTTP")) {
        return ErrorCategory.NETWORK;
    }
    return ErrorCategory.ADAPTER;
}
