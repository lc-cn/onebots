/** Teams Connector/Agents SDK 结构化错误。 */
export class TeamsApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly details?: unknown;

    constructor(
        message: string,
        options: { code?: string; status?: number; details?: unknown } = {},
    ) {
        super(message);
        this.name = "TeamsApiError";
        this.code = options.code || "TEAMS_API_ERROR";
        this.status = options.status;
        this.details = options.details;
    }

    static wrap(error: unknown, code = "TEAMS_API_ERROR"): TeamsApiError {
        if (error instanceof TeamsApiError) return error;
        if (error instanceof Error) {
            const status = readNumber(error, "statusCode") ?? readNumber(error, "status");
            return new TeamsApiError(error.message, { code, status, details: error });
        }
        return new TeamsApiError(String(error), { code, details: error });
    }
}

/** 当前还没有收到该会话的可信引用，无法安全主动发送。 */
export class TeamsConversationReferenceError extends TeamsApiError {
    constructor(conversationId: string) {
        super(
            `尚未记录 Teams 会话 ${conversationId} 的 ConversationReference；请先让机器人收到该会话事件，或调用 register_conversation_reference`,
            { code: "TEAMS_CONVERSATION_REFERENCE_MISSING" },
        );
        this.name = "TeamsConversationReferenceError";
    }
}

function readNumber(value: object, key: string): number | undefined {
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "number" ? candidate : undefined;
}
