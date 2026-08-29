import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface SlackErrorOptions {
    code?: string;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    operation?: string;
    platformCode?: string;
    status?: number;
    details?: unknown;
    cause?: unknown;
}

/** Slack 适配器的稳定错误边界，保留平台错误码与调用上下文。 */
export class SlackError extends OneBotsError {
    readonly operation?: string;
    readonly platformCode?: string;
    readonly status?: number;
    readonly details?: unknown;

    constructor(message: string, options: SlackErrorOptions = {}) {
        super(message, {
            code: options.code || normalizeSlackErrorCode(options.platformCode),
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.operation ? { operation: options.operation } : {}),
                ...(options.platformCode ? { platform_code: options.platformCode } : {}),
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "SlackError";
        this.operation = options.operation;
        this.platformCode = options.platformCode;
        this.status = options.status;
        this.details = options.details;
    }

    static wrap(error: unknown, operation?: string, code = "SLACK_API_ERROR"): SlackError {
        if (error instanceof SlackError) return error;
        const record = objectValue(error);
        const data = objectValue(record.data);
        const platformCode = stringValue(data.error) || stringValue(record.code);
        const status = numberValue(data.statusCode) ?? numberValue(record.statusCode);
        return new SlackError(error instanceof Error ? error.message : String(error), {
            code: platformCode ? undefined : code,
            operation,
            platformCode,
            status,
            details: Object.keys(data).length ? data : undefined,
            cause: error,
        });
    }

    static config(message: string, code: string, details?: unknown): SlackError {
        return new SlackError(message, { code, category: ErrorCategory.CONFIG, details });
    }

    static invalid(message: string, code: string, details?: unknown): SlackError {
        return new SlackError(message, { code, category: ErrorCategory.VALIDATION, details });
    }

    static protocol(message: string, code: string, details?: unknown): SlackError {
        return new SlackError(message, { code, category: ErrorCategory.PROTOCOL, details });
    }

    static resource(message: string, code: string, details?: unknown): SlackError {
        return new SlackError(message, { code, category: ErrorCategory.RESOURCE, details });
    }
}

function categoryFor(options: SlackErrorOptions): ErrorCategory {
    if (options.status === 400 || options.status === 422) return ErrorCategory.VALIDATION;
    if (options.status === 404) return ErrorCategory.RESOURCE;
    if (options.status === 429 || (options.status !== undefined && options.status >= 500)) {
        return ErrorCategory.NETWORK;
    }
    if (options.code?.includes("SOCKET")) return ErrorCategory.NETWORK;
    if (options.code?.includes("START") || options.code?.includes("STOP")) {
        return ErrorCategory.RUNTIME;
    }
    if (options.code?.includes("CONFIG") || options.code?.includes("REQUIRED")) {
        return ErrorCategory.CONFIG;
    }
    if (options.code?.includes("INVALID")) return ErrorCategory.VALIDATION;
    if (options.code?.includes("WEBHOOK") || options.code?.includes("EVENT")) {
        return ErrorCategory.PROTOCOL;
    }
    return ErrorCategory.ADAPTER;
}

function normalizeSlackErrorCode(value?: string): string {
    if (!value) return "SLACK_ERROR";
    const suffix = value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, 64);
    return suffix ? `SLACK_${suffix}` : "SLACK_ERROR";
}

function objectValue(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
