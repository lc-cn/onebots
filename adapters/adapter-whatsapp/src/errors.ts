import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface WhatsAppApiErrorOptions {
    code?: string;
    status?: number;
    resource?: string;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** WhatsApp Graph API 与 Webhook 的结构化错误。 */
export class WhatsAppApiError extends OneBotsError {
    readonly status?: number;
    readonly resource?: string;
    readonly details?: unknown;

    constructor(message: string, options: WhatsAppApiErrorOptions = {}) {
        super(message, {
            code: options.code || "WHATSAPP_API_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.resource === undefined ? {} : { resource: options.resource }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "WhatsAppApiError";
        this.status = options.status;
        this.resource = options.resource;
        this.details = options.details;
    }

    static wrap(error: unknown, code = "WHATSAPP_API_ERROR"): WhatsAppApiError {
        if (error instanceof WhatsAppApiError) return error;
        return new WhatsAppApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}

function categoryFor(options: WhatsAppApiErrorOptions): ErrorCategory {
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
