import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface KookErrorOptions {
    code?: string;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    method?: string;
    path?: string;
    status?: number;
    platformCode?: number;
    retryAfter?: number;
    details?: unknown;
    cause?: unknown;
}

/** KOOK REST、Gateway 与 Webhook 共用的结构化错误边界。 */
export class KookError extends OneBotsError {
    readonly method?: string;
    readonly path?: string;
    readonly status?: number;
    readonly platformCode?: number;
    readonly retryAfter?: number;
    readonly details?: unknown;

    constructor(message: string, options: KookErrorOptions = {}) {
        super(message, {
            code: options.code ?? "KOOK_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.method ? { method: options.method } : {}),
                ...(options.path ? { path: options.path } : {}),
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.platformCode === undefined
                    ? {}
                    : { platform_code: options.platformCode }),
                ...(options.retryAfter === undefined ? {} : { retry_after: options.retryAfter }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "KookError";
        this.method = options.method;
        this.path = options.path;
        this.status = options.status;
        this.platformCode = options.platformCode;
        this.retryAfter = options.retryAfter;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, options: KookErrorOptions = {}): KookError {
        if (error instanceof KookError) return error;
        return new KookError(error instanceof Error ? error.message : String(error), {
            ...options,
            code,
            cause: error,
        });
    }

    static invalid(message: string, code: string, details?: unknown): KookError {
        return new KookError(message, {
            code,
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            details,
        });
    }

    static configuration(message: string, code: string, details?: unknown): KookError {
        return new KookError(message, {
            code,
            category: ErrorCategory.CONFIG,
            details,
        });
    }

    static resource(message: string, code: string, details?: unknown): KookError {
        return new KookError(message, {
            code,
            category: ErrorCategory.RESOURCE,
            details,
        });
    }
}

/** 兼容旧导出名，同时让新增代码统一使用 KookError。 */
export class KookApiError extends KookError {
    constructor(
        message: string,
        status: number,
        platformCode?: number,
        path?: string,
        retryAfter?: number,
        details?: unknown,
    ) {
        super(message, {
            code: status === 429 ? "KOOK_RATE_LIMITED" : "KOOK_API_ERROR",
            status,
            platformCode,
            path,
            retryAfter,
            details,
        });
        this.name = "KookApiError";
    }
}

function categoryFor(options: KookErrorOptions): ErrorCategory {
    if (options.status === 400 || options.status === 422) return ErrorCategory.VALIDATION;
    if (options.status === 401 || options.status === 403) return ErrorCategory.CONFIG;
    if (options.status === 404) return ErrorCategory.RESOURCE;
    if (options.status === 429 || (options.status ?? 0) >= 500) return ErrorCategory.NETWORK;
    if (options.code?.includes("CONFIG") || options.code?.includes("TOKEN")) {
        return ErrorCategory.CONFIG;
    }
    if (options.code?.includes("INVALID") || options.code?.includes("REQUIRED")) {
        return ErrorCategory.VALIDATION;
    }
    if (options.code?.includes("GATEWAY") || options.code?.includes("NETWORK")) {
        return ErrorCategory.NETWORK;
    }
    if (options.code?.includes("WEBHOOK") || options.code?.includes("SIGNAL")) {
        return ErrorCategory.PROTOCOL;
    }
    return ErrorCategory.ADAPTER;
}
