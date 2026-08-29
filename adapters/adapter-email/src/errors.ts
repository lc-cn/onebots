export interface EmailErrorOptions {
    code: string;
    operation?: string;
    details?: unknown;
    cause?: unknown;
}

/** 邮件适配器结构化错误。 */
export class EmailError extends Error {
    readonly code: string;
    readonly operation?: string;
    readonly details?: unknown;

    constructor(message: string, options: EmailErrorOptions) {
        super(message, { cause: options.cause });
        this.name = "EmailError";
        this.code = options.code;
        this.operation = options.operation;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string, operation?: string): EmailError {
        if (error instanceof EmailError) return error;
        return new EmailError(error instanceof Error ? error.message : String(error), {
            code,
            operation,
            cause: error,
        });
    }
}
