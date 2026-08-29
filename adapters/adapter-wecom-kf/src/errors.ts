/** 微信客服 API、同步与回调的结构化错误。 */
export class WeComKfError extends Error {
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
        this.name = "WeComKfError";
        this.code = options.code || "WECOM_KF_ERROR";
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
        this.cause = options.cause;
    }

    static wrap(error: unknown, code = "WECOM_KF_ERROR"): WeComKfError {
        if (error instanceof WeComKfError) return error;
        return new WeComKfError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
