import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface DiscordErrorOptions {
    code?: string;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    method?: string;
    endpoint?: string;
    status?: number;
    discordCode?: number;
    retryAfter?: number;
    global?: boolean;
    requestId?: string;
    details?: unknown;
    cause?: unknown;
}

/** Discord REST、Gateway 与 Interaction 共用的结构化错误。 */
export class DiscordError extends OneBotsError {
    readonly method?: string;
    readonly endpoint?: string;
    readonly status?: number;
    readonly discordCode?: number;
    readonly retryAfter?: number;
    readonly global?: boolean;
    readonly requestId?: string;
    readonly details?: unknown;

    constructor(message: string, options: DiscordErrorOptions = {}) {
        super(message, {
            code: options.code ?? "DISCORD_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.method ? { method: options.method } : {}),
                ...(options.endpoint ? { endpoint: options.endpoint } : {}),
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.discordCode === undefined ? {} : { discord_code: options.discordCode }),
                ...(options.retryAfter === undefined ? {} : { retry_after: options.retryAfter }),
                ...(options.global === undefined ? {} : { global: options.global }),
                ...(options.requestId ? { request_id: options.requestId } : {}),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "DiscordError";
        this.method = options.method;
        this.endpoint = options.endpoint;
        this.status = options.status;
        this.discordCode = options.discordCode;
        this.retryAfter = options.retryAfter;
        this.global = options.global;
        this.requestId = options.requestId;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, options: DiscordErrorOptions = {}): DiscordError {
        if (error instanceof DiscordError) return error;
        return new DiscordError(error instanceof Error ? error.message : String(error), {
            ...options,
            code,
            cause: error,
        });
    }

    static invalid(message: string, code: string, details?: unknown): DiscordError {
        return new DiscordError(message, {
            code,
            category: ErrorCategory.VALIDATION,
            details,
        });
    }

    static configuration(message: string, code: string, details?: unknown): DiscordError {
        return new DiscordError(message, {
            code,
            category: ErrorCategory.CONFIG,
            details,
        });
    }

    static resource(message: string, code: string, details?: unknown): DiscordError {
        return new DiscordError(message, {
            code,
            category: ErrorCategory.RESOURCE,
            details,
        });
    }
}

function categoryFor(options: DiscordErrorOptions): ErrorCategory {
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
    return ErrorCategory.ADAPTER;
}
