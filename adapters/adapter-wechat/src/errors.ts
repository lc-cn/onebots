/** 微信公众号 API 与 Webhook 的结构化错误。 */
export class WechatApiError extends Error {
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
        this.name = "WechatApiError";
        this.code = options.code || "WECHAT_API_ERROR";
        this.status = options.status;
        this.path = options.path;
        this.details = options.details;
        this.cause = options.cause;
    }

    static wrap(error: unknown, code = "WECHAT_API_ERROR"): WechatApiError {
        if (error instanceof WechatApiError) return error;
        return new WechatApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
