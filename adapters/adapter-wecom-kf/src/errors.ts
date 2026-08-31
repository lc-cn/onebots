import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface WeComKfErrorOptions {
    code?: string;
    status?: number;
    path?: string;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** 微信客服 API、同步与回调的结构化错误。 */
export class WeComKfError extends OneBotsError {
    readonly status?: number;
    readonly path?: string;
    readonly details?: unknown;

    constructor(message: string, options: WeComKfErrorOptions = {}) {
        super(message, {
            code: options.code || "WECOM_KF_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.path === undefined ? {} : { path: options.path }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "WeComKfError";
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
    }

    static wrap(error: unknown, code = "WECOM_KF_ERROR"): WeComKfError {
        if (error instanceof WeComKfError) return error;
        return new WeComKfError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}

function categoryFor(options: WeComKfErrorOptions): ErrorCategory {
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
    if (options.code?.includes("WEBHOOK") || options.code?.includes("CALLBACK")) {
        return ErrorCategory.PROTOCOL;
    }
    if (options.code?.includes("NETWORK") || options.code?.includes("HTTP")) {
        return ErrorCategory.NETWORK;
    }
    return ErrorCategory.ADAPTER;
}

export function invalidKfParameter(message: string, path?: string): WeComKfError {
    return new WeComKfError(`微信客服 ${message}`, {
        code: "WECOM_KF_INVALID_PARAMETER",
        path,
    });
}

export function ensureKfNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw kfAborted();
}

export function kfAborted(): WeComKfError {
    return new WeComKfError("微信客服客户端已停止", { code: "WECOM_KF_ABORTED" });
}

export function isKfAborted(error: unknown): boolean {
    return error instanceof WeComKfError && error.code === "WECOM_KF_ABORTED";
}
