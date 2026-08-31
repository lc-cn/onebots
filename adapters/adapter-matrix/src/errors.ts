import { AdapterError, NetworkError, ValidationError } from "onebots";

export interface MatrixErrorOptions {
    code: string;
    status?: number;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
}

/** 保留 Matrix errcode、HTTP 状态和限流窗口的结构化错误。 */
export class MatrixError extends AdapterError {
    readonly status?: number;
    readonly retryAfterMs?: number;
    readonly details?: Record<string, unknown>;

    constructor(message: string, options: MatrixErrorOptions) {
        super(message, {
            code: options.code,
            context: { platform: "matrix", ...options.details },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.status = options.status;
        this.retryAfterMs = options.retryAfterMs;
        this.details = options.details;
    }

    static invalid(message: string, details?: Record<string, unknown>): ValidationError {
        return new ValidationError(message, { context: { platform: "matrix", ...details } });
    }

    static network(message: string, cause?: unknown): NetworkError {
        return new NetworkError(message, {
            context: { platform: "matrix" },
            cause: cause instanceof Error ? cause : undefined,
        });
    }

    static wrap(error: unknown, code = "MATRIX_ERROR"): MatrixError {
        if (error instanceof MatrixError) return error;
        return new MatrixError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
