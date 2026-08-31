import { ApiError } from "@tencent-connect/qqbot-nodejs/protocol";
import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface QQApiErrorOptions {
    code?: string;
    status?: number;
    path?: string;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    details?: unknown;
}

/** QQ 开放平台调用错误，保留 HTTP 与业务错误字段供协议层判断。 */
export class QQApiError extends OneBotsError {
    readonly code: string;
    readonly status?: number;
    readonly path?: string;

    constructor(message: string, options: QQApiErrorOptions = {}) {
        const code = options.code ?? "QQ_API_ERROR";
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
        this.name = "QQApiError";
        this.code = code;
        this.status = options.status;
        this.path = options.path;
    }

    static wrap(error: unknown, code = "QQ_API_ERROR"): QQApiError {
        if (error instanceof QQApiError) return error;
        if (error instanceof ApiError) {
            return new QQApiError(error.message, {
                code: error.bizCode == null ? code : `QQ_${error.bizCode}`,
                status: error.httpStatus,
                path: error.path,
                cause: error,
            });
        }
        return new QQApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }

    /** 入站动作和消息负载错误，协议层可稳定投影为客户端错误。 */
    static invalid(message: string, code: string, details?: unknown): QQApiError {
        return new QQApiError(message, {
            code,
            category: ErrorCategory.VALIDATION,
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
