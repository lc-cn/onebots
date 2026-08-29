import { ApiError } from "@tencent-connect/qqbot-nodejs/protocol";

/** QQ 开放平台调用错误，保留 HTTP 与业务错误字段供协议层判断。 */
export class QQApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly path?: string;
    readonly cause?: unknown;

    constructor(
        message: string,
        options: { code?: string; status?: number; path?: string; cause?: unknown } = {},
    ) {
        super(message);
        this.name = "QQApiError";
        this.code = options.code ?? "QQ_API_ERROR";
        this.status = options.status;
        this.path = options.path;
        this.cause = options.cause;
    }

    static wrap(error: unknown, code = "QQ_API_ERROR"): QQApiError {
        if (error instanceof QQApiError) return error;
        if (error instanceof ApiError) {
            return new QQApiError(error.message, {
                code: error.bizCode == null ? code : `QQ_${error.bizCode}`,
                status: error.httpStatus,
                path: error.path,
                cause: error,
            });
        }
        return new QQApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
