export interface HeychatApiErrorOptions {
    code?: string;
    status?: number;
    path?: string;
    details?: unknown;
    cause?: unknown;
}

/** 保留 HTTP 状态、平台错误体与请求路径的稳定错误类型。 */
export class HeychatApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly path?: string;
    readonly details?: unknown;

    constructor(message: string, options: HeychatApiErrorOptions = {}) {
        super(message, { cause: options.cause });
        this.name = "HeychatApiError";
        this.code = options.code || "HEYCHAT_API_ERROR";
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
    }

    static wrap(error: unknown, code = "HEYCHAT_API_ERROR"): HeychatApiError {
        if (error instanceof HeychatApiError) return error;
        return new HeychatApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}

export function normalizeHeychatErrorCode(value: string): string {
    const suffix = value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, 64);
    return suffix ? `HEYCHAT_${suffix}` : "HEYCHAT_API_ERROR";
}
