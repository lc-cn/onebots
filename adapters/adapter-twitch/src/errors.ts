export interface TwitchErrorOptions {
    code?: string;
    status?: number;
    requestId?: string;
    retryAfterMs?: number;
    rateLimitResetAt?: number;
    details?: unknown;
    cause?: unknown;
}

/** 保留 Helix/EventSub 的结构化失败信息，便于上层判断鉴权、限流与重试。 */
export class TwitchError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly requestId?: string;
    readonly retryAfterMs?: number;
    readonly rateLimitResetAt?: number;
    readonly details?: unknown;

    constructor(message: string, options: TwitchErrorOptions = {}) {
        super(message, { cause: options.cause });
        this.name = "TwitchError";
        this.code = options.code || "TWITCH_ERROR";
        this.status = options.status;
        this.requestId = options.requestId;
        this.retryAfterMs = options.retryAfterMs;
        this.rateLimitResetAt = options.rateLimitResetAt;
        this.details = options.details;
    }

    static invalid(message: string, details?: unknown): TwitchError {
        return new TwitchError(message, { code: "TWITCH_INVALID_INPUT", details });
    }

    static protocol(message: string, details?: unknown): TwitchError {
        return new TwitchError(message, { code: "TWITCH_PROTOCOL_ERROR", details });
    }

    static wrap(error: unknown, message: string, code = "TWITCH_RUNTIME_ERROR"): TwitchError {
        return error instanceof TwitchError
            ? error
            : new TwitchError(message, { code, cause: error });
    }
}
