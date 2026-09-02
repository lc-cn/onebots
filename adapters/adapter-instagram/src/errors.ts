import { MetaError, type MetaErrorOptions } from "@onebots/meta";
import { ValidationError } from "onebots";

export class InstagramError extends MetaError {
    constructor(message: string, options: MetaErrorOptions) {
        super(message, options);
        this.name = "InstagramError";
    }

    static invalid(message: string, details?: Record<string, unknown>): ValidationError {
        return new ValidationError(message, { context: { platform: "instagram", ...details } });
    }

    static wrap(error: unknown, code = "INSTAGRAM_ERROR"): InstagramError {
        if (error instanceof InstagramError) return error;
        if (error instanceof MetaError) {
            return new InstagramError(error.message, {
                code: error.code,
                status: error.status,
                details: error.details,
                cause: error,
            });
        }
        return new InstagramError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
