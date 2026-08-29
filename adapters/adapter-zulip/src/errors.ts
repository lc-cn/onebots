import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface ZulipErrorOptions {
    code?: string;
    status?: number;
    details?: unknown;
    cause?: unknown;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
}

/** Zulip API、传输和生命周期错误。 */
export class ZulipError extends OneBotsError {
    readonly status?: number;
    readonly details?: unknown;

    constructor(message: string, options: ZulipErrorOptions = {}) {
        super(message, {
            code: options.code || "ZULIP_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "ZulipError";
        this.status = options.status;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string): ZulipError {
        return error instanceof ZulipError
            ? error
            : new ZulipError(error instanceof Error ? error.message : String(error), {
                  code,
                  cause: error,
              });
    }
}

function categoryFor(options: ZulipErrorOptions): ErrorCategory {
    if (options.status === 400 || options.status === 422) return ErrorCategory.VALIDATION;
    if (options.status === 401 || options.status === 403) return ErrorCategory.CONFIG;
    if (options.status === 404) return ErrorCategory.RESOURCE;
    if (options.status === 429 || (options.status ?? 0) >= 500) return ErrorCategory.NETWORK;
    if (options.code?.includes("CONFIG") || options.code?.includes("AUTH")) {
        return ErrorCategory.CONFIG;
    }
    if (options.code?.includes("INVALID") || options.code?.includes("REQUIRED")) {
        return ErrorCategory.VALIDATION;
    }
    if (options.code?.includes("NETWORK") || options.code?.includes("TIMEOUT")) {
        return ErrorCategory.NETWORK;
    }
    return ErrorCategory.ADAPTER;
}

/** 判断 Event Queue 是否已被服务器回收。 */
export function isBadEventQueue(error: unknown): boolean {
    return error instanceof ZulipError && error.code === "BAD_EVENT_QUEUE_ID";
}
