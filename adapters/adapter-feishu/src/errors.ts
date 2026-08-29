export interface FeishuErrorOptions {
    code: string;
    operation?: string;
    status?: number;
    details?: unknown;
    cause?: unknown;
}

/** 飞书/Lark 的结构化 SDK 错误。 */
export class FeishuError extends Error {
    readonly code: string;
    readonly operation?: string;
    readonly status?: number;
    readonly details?: unknown;

    constructor(message: string, options: FeishuErrorOptions) {
        super(message, { cause: options.cause });
        this.name = "FeishuError";
        this.code = options.code;
        this.operation = options.operation;
        this.status = options.status;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, operation?: string): FeishuError {
        if (error instanceof FeishuError) return error;
        return new FeishuError(error instanceof Error ? error.message : String(error), {
            code,
            operation,
            cause: error,
        });
    }
}

export function invalidFeishuParam(message: string, details?: unknown): FeishuError {
    return new FeishuError(message, { code: "FEISHU_INVALID_PARAM", details });
}
