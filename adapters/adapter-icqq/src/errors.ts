import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface ICQQErrorOptions {
    code: string;
    operation?: string;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** ICQQ 客户端、参数和平台资源共享的结构化错误。 */
export class ICQQError extends OneBotsError {
    readonly code: string;
    readonly operation?: string;
    readonly details?: unknown;

    constructor(message: string, options: ICQQErrorOptions) {
        super(message, {
            category: options.category ?? ErrorCategory.ADAPTER,
            severity: options.severity ?? ErrorSeverity.HIGH,
            code: options.code,
            context: {
                ...(options.operation ? { operation: options.operation } : {}),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "ICQQError";
        this.code = options.code;
        this.operation = options.operation;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, operation?: string): ICQQError {
        if (error instanceof ICQQError) return error;
        return new ICQQError(error instanceof Error ? error.message : String(error), {
            code,
            operation,
            cause: error,
        });
    }
}

export function invalidICQQParam(message: string, details?: unknown): ICQQError {
    return new ICQQError(message, {
        code: "ICQQ_INVALID_PARAM",
        category: ErrorCategory.VALIDATION,
        details,
    });
}

export function icqqResourceNotFound(resource: string, id: unknown): ICQQError {
    return new ICQQError(`ICQQ ${resource} 不存在`, {
        code: "ICQQ_RESOURCE_NOT_FOUND",
        category: ErrorCategory.RESOURCE,
        details: { resource, id },
    });
}

export function icqqOperationRejected(operation: string, details?: unknown): ICQQError {
    return new ICQQError(`ICQQ ${operation}失败`, {
        code: "ICQQ_OPERATION_REJECTED",
        operation,
        details,
    });
}
