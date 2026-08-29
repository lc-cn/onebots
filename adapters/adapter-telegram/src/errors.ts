import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface TelegramErrorOptions {
    code?: string;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    method?: string;
    platformCode?: number;
    retryAfter?: number;
    migrateToChatId?: number;
    details?: unknown;
    cause?: unknown;
}

/** grammY 与 Telegram Bot API 的结构化错误边界。 */
export class TelegramError extends OneBotsError {
    readonly method?: string;
    readonly platformCode?: number;
    readonly retryAfter?: number;
    readonly migrateToChatId?: number;
    readonly details?: unknown;

    constructor(message: string, options: TelegramErrorOptions = {}) {
        super(message, {
            code: options.code || "TELEGRAM_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.method ? { method: options.method } : {}),
                ...(options.platformCode === undefined
                    ? {}
                    : { platform_code: options.platformCode }),
                ...(options.retryAfter === undefined ? {} : { retry_after: options.retryAfter }),
                ...(options.migrateToChatId === undefined
                    ? {}
                    : { migrate_to_chat_id: options.migrateToChatId }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "TelegramError";
        this.method = options.method;
        this.platformCode = options.platformCode;
        this.retryAfter = options.retryAfter;
        this.migrateToChatId = options.migrateToChatId;
        this.details = options.details;
    }

    static wrap(error: unknown, code = "TELEGRAM_API_ERROR", method?: string): TelegramError {
        if (error instanceof TelegramError) return error;
        const source = unwrapBotError(error);
        const record = objectValue(source);
        const parameters = objectValue(record.parameters);
        return new TelegramError(source instanceof Error ? source.message : String(source), {
            code,
            method: stringValue(record.method) || method,
            platformCode: numberValue(record.error_code),
            retryAfter: numberValue(parameters.retry_after),
            migrateToChatId: numberValue(parameters.migrate_to_chat_id),
            details: Object.keys(record).length ? record : source,
            cause: source,
        });
    }

    static invalid(message: string, code: string, details?: unknown): TelegramError {
        return new TelegramError(message, {
            code,
            category: ErrorCategory.VALIDATION,
            details,
        });
    }

    static resource(message: string, code: string, details?: unknown): TelegramError {
        return new TelegramError(message, { code, category: ErrorCategory.RESOURCE, details });
    }

    static configuration(message: string, code: string, details?: unknown): TelegramError {
        return new TelegramError(message, { code, category: ErrorCategory.CONFIG, details });
    }
}

function categoryFor(options: TelegramErrorOptions): ErrorCategory {
    if (options.platformCode === 400) return ErrorCategory.VALIDATION;
    if (options.platformCode === 404) return ErrorCategory.RESOURCE;
    if (options.platformCode === 429 || (options.platformCode ?? 0) >= 500) {
        return ErrorCategory.NETWORK;
    }
    if (options.code?.includes("CONFIG") || options.code?.includes("TOKEN_REQUIRED")) {
        return ErrorCategory.CONFIG;
    }
    if (options.code?.includes("INVALID") || options.code?.includes("REQUIRED")) {
        return ErrorCategory.VALIDATION;
    }
    if (options.code?.includes("NETWORK") || options.code?.includes("POLLING")) {
        return ErrorCategory.NETWORK;
    }
    if (options.code?.includes("UPDATE") || options.code?.includes("WEBHOOK")) {
        return ErrorCategory.PROTOCOL;
    }
    return ErrorCategory.ADAPTER;
}

function unwrapBotError(error: unknown): unknown {
    const record = objectValue(error);
    return "error" in record ? record.error : error;
}

function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
