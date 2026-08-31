import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface DingTalkErrorOptions {
    code?: string;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    status?: number;
    path?: string;
    details?: unknown;
    cause?: unknown;
}

/** 钉钉适配器的稳定错误边界，供协议层按 code/category 处理。 */
export class DingTalkError extends OneBotsError {
    readonly status?: number;
    readonly path?: string;
    readonly details?: unknown;

    constructor(message: string, options: DingTalkErrorOptions = {}) {
        super(message, {
            code: options.code || "DINGTALK_ERROR",
            category: options.category ?? ErrorCategory.ADAPTER,
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.path ? { path: options.path } : {}),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "DingTalkError";
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
    }

    static wrap(
        error: unknown,
        code = "DINGTALK_ERROR",
        category = ErrorCategory.ADAPTER,
        details?: unknown,
    ): DingTalkError {
        if (error instanceof DingTalkError) return error;
        return new DingTalkError(error instanceof Error ? error.message : String(error), {
            code,
            category,
            details,
            cause: error,
        });
    }

    static config(message: string, code: string, details?: unknown): DingTalkError {
        return new DingTalkError(message, { code, category: ErrorCategory.CONFIG, details });
    }

    static invalid(message: string, code: string, details?: unknown): DingTalkError {
        return new DingTalkError(message, { code, category: ErrorCategory.VALIDATION, details });
    }

    static resource(message: string, code: string, details?: unknown): DingTalkError {
        return new DingTalkError(message, { code, category: ErrorCategory.RESOURCE, details });
    }

    static protocol(message: string, code: string, details?: unknown): DingTalkError {
        return new DingTalkError(message, { code, category: ErrorCategory.PROTOCOL, details });
    }
}

export interface DingTalkApiErrorOptions extends DingTalkErrorOptions {
    status: number;
    platformCode?: string | number;
    requestId?: string;
}

/** 钉钉开放平台调用错误；平台业务码与 OneBots 稳定错误码分离保存。 */
export class DingTalkApiError extends DingTalkError {
    readonly platformCode?: string | number;
    readonly requestId?: string;

    constructor(message: string, options: DingTalkApiErrorOptions) {
        const code = options.code || normalizeDingTalkErrorCode(options.platformCode);
        super(message, {
            ...options,
            code,
            category: options.category ?? categoryForStatus(options.status),
            details: {
                ...(options.details === undefined ? {} : { response: options.details }),
                ...(options.platformCode === undefined
                    ? {}
                    : { platform_code: options.platformCode }),
                ...(options.requestId ? { request_id: options.requestId } : {}),
            },
        });
        this.name = "DingTalkApiError";
        this.platformCode = options.platformCode;
        this.requestId = options.requestId;
    }
}

function categoryForStatus(status: number): ErrorCategory {
    if (status === 400 || status === 422) return ErrorCategory.VALIDATION;
    if (status === 404) return ErrorCategory.RESOURCE;
    if (status >= 500) return ErrorCategory.NETWORK;
    return ErrorCategory.ADAPTER;
}

function normalizeDingTalkErrorCode(value: string | number | undefined): string {
    if (value === undefined || value === "") return "DINGTALK_API_ERROR";
    const suffix = String(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, 64);
    return suffix ? `DINGTALK_${suffix}` : "DINGTALK_API_ERROR";
}
