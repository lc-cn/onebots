/** 企业微信 API 与回调结构化错误。 */
export class WeComApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly path?: string;
    readonly details?: unknown;
    override readonly cause?: unknown;

    constructor(
        message: string,
        options: {
            code?: string;
            status?: number;
            path?: string;
            details?: unknown;
            cause?: unknown;
        } = {},
    ) {
        super(message);
        this.name = "WeComApiError";
        this.code = options.code || "WECOM_API_ERROR";
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
        this.cause = options.cause;
    }

    static wrap(error: unknown, code = "WECOM_API_ERROR"): WeComApiError {
        if (error instanceof WeComApiError) return error;
        return new WeComApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
