import {
    ErrorCategory,
    ErrorSeverity,
    NetworkError,
    OneBotsError,
    ValidationError,
} from "@onebots/core";

export interface MetaErrorOptions {
    code: string;
    status?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
}

export class MetaError extends OneBotsError {
    readonly status?: number;
    readonly details?: Record<string, unknown>;

    constructor(message: string, options: MetaErrorOptions) {
        super(message, {
            category: ErrorCategory.PROTOCOL,
            severity: ErrorSeverity.MEDIUM,
            code: options.code,
            context: { protocol: "meta", ...options.details },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.status = options.status;
        this.details = options.details;
        this.name = "MetaError";
    }

    static invalid(message: string, details?: Record<string, unknown>): ValidationError {
        return new ValidationError(message, { context: { protocol: "meta", ...details } });
    }

    static network(message: string, cause?: unknown): NetworkError {
        return new NetworkError(message, {
            context: { protocol: "meta" },
            cause: cause instanceof Error ? cause : undefined,
        });
    }

    static wrap(error: unknown, code = "META_ERROR"): MetaError {
        if (error instanceof MetaError) return error;
        return new MetaError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
