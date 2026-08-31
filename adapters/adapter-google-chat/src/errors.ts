import { AdapterError, NetworkError, ValidationError } from "onebots";

export interface GoogleChatErrorOptions {
    code: string;
    status?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
}

export class GoogleChatError extends AdapterError {
    readonly status?: number;
    readonly details?: Record<string, unknown>;

    constructor(message: string, options: GoogleChatErrorOptions) {
        super(message, {
            code: options.code,
            context: { platform: "google-chat", ...options.details },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.status = options.status;
        this.details = options.details;
    }

    static invalid(message: string, details?: Record<string, unknown>): ValidationError {
        return new ValidationError(message, {
            context: { platform: "google-chat", ...details },
        });
    }

    static network(message: string, cause?: unknown): NetworkError {
        return new NetworkError(message, {
            context: { platform: "google-chat" },
            cause: cause instanceof Error ? cause : undefined,
        });
    }

    static wrap(error: unknown, code = "GOOGLE_CHAT_ERROR"): GoogleChatError {
        if (error instanceof GoogleChatError) return error;
        return new GoogleChatError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
