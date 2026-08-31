import { ErrorCategory, ErrorSeverity, OneBotsError } from "onebots";

export interface TeamsApiErrorOptions {
    code?: string;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    operation?: string;
    platformCode?: string;
    status?: number;
    details?: unknown;
    cause?: unknown;
}

/** Teams Connector、Agents SDK 与 Graph 的结构化错误边界。 */
export class TeamsApiError extends OneBotsError {
    readonly operation?: string;
    readonly platformCode?: string;
    readonly status?: number;
    readonly details?: unknown;

    constructor(message: string, options: TeamsApiErrorOptions = {}) {
        super(message, {
            code: options.code || "TEAMS_API_ERROR",
            category: options.category ?? categoryFor(options),
            severity: options.severity ?? ErrorSeverity.HIGH,
            context: {
                ...(options.operation ? { operation: options.operation } : {}),
                ...(options.platformCode ? { platform_code: options.platformCode } : {}),
                ...(options.status === undefined ? {} : { status: options.status }),
                ...(options.details === undefined ? {} : { details: options.details }),
            },
            cause: options.cause instanceof Error ? options.cause : undefined,
        });
        this.name = "TeamsApiError";
        this.operation = options.operation;
        this.platformCode = options.platformCode;
        this.status = options.status;
        this.details = options.details;
    }

    static wrap(error: unknown, code = "TEAMS_API_ERROR", operation?: string): TeamsApiError {
        if (error instanceof TeamsApiError) return error;
        const status = readNumber(error, "statusCode") ?? readNumber(error, "status");
        return new TeamsApiError(error instanceof Error ? error.message : String(error), {
            code,
            operation,
            status,
            details: error,
            cause: error,
        });
    }

    static invalid(message: string, code: string, details?: unknown): TeamsApiError {
        return new TeamsApiError(message, { code, category: ErrorCategory.VALIDATION, details });
    }

    static resource(message: string, code: string, details?: unknown): TeamsApiError {
        return new TeamsApiError(message, { code, category: ErrorCategory.RESOURCE, details });
    }
}

/** 当前还没有收到该会话的可信引用，无法安全主动发送。 */
export class TeamsConversationReferenceError extends TeamsApiError {
    constructor(conversationId: string) {
        super(
            `尚未记录 Teams 会话 ${conversationId} 的 ConversationReference；请先让机器人收到该会话事件，或调用 register_conversation_reference`,
            {
                code: "TEAMS_CONVERSATION_REFERENCE_MISSING",
                category: ErrorCategory.RESOURCE,
                details: { conversation_id: conversationId },
            },
        );
        this.name = "TeamsConversationReferenceError";
    }
}

function categoryFor(options: TeamsApiErrorOptions): ErrorCategory {
    if (options.status === 400 || options.status === 422) return ErrorCategory.VALIDATION;
    if (options.status === 404) return ErrorCategory.RESOURCE;
    if (options.status === 408 || options.status === 429) return ErrorCategory.NETWORK;
    if (options.status !== undefined && options.status >= 500) return ErrorCategory.NETWORK;
    if (options.code?.includes("NETWORK")) return ErrorCategory.NETWORK;
    if (options.code?.includes("CONFIG") || options.code?.includes("TENANT_REQUIRED")) {
        return ErrorCategory.CONFIG;
    }
    if (options.code?.includes("INVALID") || options.code?.includes("REQUIRED")) {
        return ErrorCategory.VALIDATION;
    }
    if (options.code?.includes("MISSING") || options.code?.includes("NOT_FOUND")) {
        return ErrorCategory.RESOURCE;
    }
    if (options.code?.includes("WEBHOOK") || options.code?.includes("TURN")) {
        return ErrorCategory.PROTOCOL;
    }
    return ErrorCategory.ADAPTER;
}

function readNumber(value: unknown, key: string): number | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}
