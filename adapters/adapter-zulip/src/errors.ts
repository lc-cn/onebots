/** Zulip API、传输和生命周期错误。 */
export class ZulipError extends Error {
    readonly code?: string;
    readonly status?: number;
    readonly details?: unknown;

    constructor(
        message: string,
        options: { code?: string; status?: number; details?: unknown; cause?: unknown } = {},
    ) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "ZulipError";
        this.code = options.code;
        this.status = options.status;
        this.details = options.details;
    }

    static wrap(error: unknown, code: string): ZulipError {
        return error instanceof ZulipError
            ? error
            : new ZulipError(error instanceof Error ? error.message : String(error), {
                  code,
                  cause: error,
              });
    }
}

/** 判断 Event Queue 是否已被服务器回收。 */
export function isBadEventQueue(error: unknown): boolean {
    return error instanceof ZulipError && error.code === "BAD_EVENT_QUEUE_ID";
}
