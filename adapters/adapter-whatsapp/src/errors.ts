/** WhatsApp Graph API 与 Webhook 的结构化错误。 */
export class WhatsAppApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly resource?: string;
    readonly details?: unknown;
    override readonly cause?: unknown;

    constructor(
        message: string,
        options: {
            code?: string;
            status?: number;
            resource?: string;
            details?: unknown;
            cause?: unknown;
        } = {},
    ) {
        super(message);
        this.name = "WhatsAppApiError";
        this.code = options.code || "WHATSAPP_API_ERROR";
        this.status = options.status;
        this.resource = options.resource;
        this.details = options.details;
        this.cause = options.cause;
    }

    static wrap(error: unknown, code = "WHATSAPP_API_ERROR"): WhatsAppApiError {
        if (error instanceof WhatsAppApiError) return error;
        return new WhatsAppApiError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
