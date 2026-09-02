export interface Ircv3ErrorOptions {
    code: string;
    status?: number;
    command?: string;
    cause?: unknown;
}

/** IRC framing、会话、认证与服务器回复共用的结构化错误。 */
export class Ircv3Error extends Error {
    readonly code: string;
    readonly status?: number;
    readonly command?: string;

    constructor(message: string, options: Ircv3ErrorOptions) {
        super(message, { cause: options.cause });
        this.name = "Ircv3Error";
        this.code = options.code;
        this.status = options.status;
        this.command = options.command;
    }

    static invalid(message: string, code = "IRCV3_INVALID_INPUT"): Ircv3Error {
        return new Ircv3Error(message, { code });
    }

    static wrap(error: unknown, message: string, code: string): Ircv3Error {
        return error instanceof Ircv3Error
            ? error
            : new Ircv3Error(message, { code, cause: error });
    }
}
