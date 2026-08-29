import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface HeychatApiErrorOptions {
    code?: string;
    status?: number;
    path?: string;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** 保留 HTTP 状态、平台错误体与请求路径的稳定错误类型。 */
export class HeychatApiError extends OneBotsError {
    readonly code: string;
    readonly status?: number;
    readonly path?: string;
    readonly details?: unknown;

    constructor(message: string, options: HeychatApiErrorOptions = {}) {
        const code = options.code || "HEYCHAT_API_ERROR";
        super(message, {
            code,
            category: options.category ?? categoryForStatus(options.status),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.path ? { path: options.path } : {}),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "HeychatApiError";
        this.code = code;
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
    }

    static wrap(
        error: unknown,
        code = "HEYCHAT_API_ERROR",
        category = ErrorCategory.ADAPTER,
    ): HeychatApiError {
        if (error instanceof HeychatApiError) return error;
        return new HeychatApiError(error instanceof Error ? error.message : String(error), {
            code,
            category,
            cause: error,
        });
    }

    static invalid(message: string, code: string, details?: unknown): HeychatApiError {
        return new HeychatApiError(message, {
            code,
            category: ErrorCategory.VALIDATION,
            details,
        });
    }

    static resource(message: string, code: string, details?: unknown): HeychatApiError {
        return new HeychatApiError(message, {
            code,
            category: ErrorCategory.RESOURCE,
            details,
        });
    }
}

function categoryForStatus(status: number | undefined): ErrorCategory {
    if (status === 400 || status === 422) return ErrorCategory.VALIDATION;
    if (status === 404) return ErrorCategory.RESOURCE;
    if (status !== undefined && status >= 500) return ErrorCategory.NETWORK;
    return ErrorCategory.ADAPTER;
}

export function normalizeHeychatErrorCode(value: string): string {
    const suffix = value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, 64);
    return suffix ? `HEYCHAT_${suffix}` : "HEYCHAT_API_ERROR";
}
