import { AdapterError, NetworkError, ValidationError } from "onebots";

export interface MattermostErrorOptions {
    code: string;
    status?: number;
    requestId?: string;
    detailedError?: string;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
}

/** 保留 Mattermost error id、request_id、HTTP 状态与限流窗口的结构化错误。 */
export class MattermostError extends AdapterError {
    readonly status?: number;
    readonly requestId?: string;
    readonly detailedError?: string;
    readonly retryAfterMs?: number;
    readonly details?: Record<string, unknown>;

    constructor(message: string, options: MattermostErrorOptions) {
        super(message, {
            code: options.code,
            context: { platform: "mattermost", ...options.details },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.status = options.status;
        this.requestId = options.requestId;
        this.detailedError = options.detailedError;
        this.retryAfterMs = options.retryAfterMs;
        this.details = options.details;
    }

    static invalid(message: string, details?: Record<string, unknown>): ValidationError {
        return new ValidationError(message, {
            context: { platform: "mattermost", ...details },
        });
    }

    static network(message: string, cause?: unknown): NetworkError {
        return new NetworkError(message, {
            context: { platform: "mattermost" },
            cause: cause instanceof Error ? cause : undefined,
        });
    }

    static wrap(error: unknown, code = "MATTERMOST_ERROR"): MattermostError {
        if (error instanceof MattermostError) return error;
        return new MattermostError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
