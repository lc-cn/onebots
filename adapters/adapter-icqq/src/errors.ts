export interface ICQQErrorOptions {
    code: string;
    operation?: string;
    details?: unknown;
    cause?: unknown;
}

/** ICQQ 客户端、参数和平台资源共享的结构化错误。 */
export class ICQQError extends Error {
    readonly code: string;
    readonly operation?: string;
    readonly details?: unknown;

    constructor(message: string, options: ICQQErrorOptions) {
        super(message, { cause: options.cause });
        this.name = "ICQQError";
        this.code = options.code;
        this.operation = options.operation;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, operation?: string): ICQQError {
        if (error instanceof ICQQError) return error;
        return new ICQQError(error instanceof Error ? error.message : String(error), {
            code,
            operation,
            cause: error,
        });
    }
}

export function invalidICQQParam(message: string, details?: unknown): ICQQError {
    return new ICQQError(message, { code: "ICQQ_INVALID_PARAM", details });
}
