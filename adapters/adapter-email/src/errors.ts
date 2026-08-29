import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface EmailErrorOptions {
    code: string;
    operation?: string;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** 邮件适配器结构化错误。 */
export class EmailError extends OneBotsError {
    readonly operation?: string;
    readonly details?: unknown;

    constructor(message: string, options: EmailErrorOptions) {
        super(message, {
            code: options.code,
            category: options.category ?? categoryFor(options.code),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.operation === undefined ? {} : { operation: options.operation }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "EmailError";
        this.operation = options.operation;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, operation?: string): EmailError {
        if (error instanceof EmailError) return error;
        return new EmailError(error instanceof Error ? error.message : String(error), {
            code,
            operation,
            cause: error,
        });
    }
}

function categoryFor(code: string): ErrorCategory {
    if (
        code.includes("AUTH") ||
        code.includes("CONFIG") ||
        code.includes("PROXY") ||
        code.includes("DISABLED")
    ) {
        return ErrorCategory.CONFIG;
    }
    if (code.includes("NOT_FOUND") || code.includes("UIDVALIDITY")) {
        return ErrorCategory.RESOURCE;
    }
    if (
        code.includes("INVALID") ||
        code.includes("REQUIRED") ||
        code.includes("EMPTY") ||
        code.includes("UNAVAILABLE")
    ) {
        return ErrorCategory.VALIDATION;
    }
    if (
        code.includes("CONNECT") ||
        code.includes("DISCONNECT") ||
        code.includes("NETWORK") ||
        code.includes("TIMEOUT") ||
        code.includes("SMTP") ||
        code.includes("IMAP")
    ) {
        return ErrorCategory.NETWORK;
    }
    return ErrorCategory.ADAPTER;
}
