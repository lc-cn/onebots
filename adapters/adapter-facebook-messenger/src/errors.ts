import { MetaError, type MetaErrorOptions } from "@onebots/meta";
import { ValidationError } from "onebots";

export class FacebookMessengerError extends MetaError {
    constructor(message: string, options: MetaErrorOptions) {
        super(message, options);
        this.name = "FacebookMessengerError";
    }

    static invalid(message: string, details?: Record<string, unknown>): ValidationError {
        return new ValidationError(message, {
            context: { platform: "facebook-messenger", ...details },
        });
    }

    static wrap(error: unknown, code = "FACEBOOK_MESSENGER_ERROR"): FacebookMessengerError {
        if (error instanceof FacebookMessengerError) return error;
        if (error instanceof MetaError) {
            return new FacebookMessengerError(error.message, {
                code: error.code,
                status: error.status,
                details: error.details,
                cause: error,
            });
        }
        return new FacebookMessengerError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
