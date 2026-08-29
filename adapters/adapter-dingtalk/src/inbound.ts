import type { DWClientDownStream } from "dingtalk-stream";
import { ErrorCategory } from "onebots";
import { DingTalkError } from "./errors.js";
import type { DingTalkEvent, DingTalkRobotMessage } from "./types.js";

export function streamEvent(message: DWClientDownStream): DingTalkEvent {
    const eventData = parseObject(message.data, "钉钉 Stream 事件");
    return {
        eventType: message.headers.eventType || message.headers.topic,
        eventId: message.headers.eventId || message.headers.messageId,
        eventTime: Number(message.headers.eventBornTime || message.headers.time) || Date.now(),
        eventCorpId: message.headers.eventCorpId,
        eventData,
        raw: { headers: { ...message.headers }, data: eventData, type: message.type },
    };
}

export function webhookEvent(body: Record<string, unknown>): DingTalkEvent {
    return {
        eventType: String(body.EventType || body.eventType || body.type || "unknown"),
        eventId: String(body.eventId || body.id || `${Date.now()}`),
        eventTime: Number(body.eventTime || body.timestamp) || Date.now(),
        eventCorpId: stringValue(body.CorpId || body.corpId || body.eventCorpId),
        eventData: objectOrSelf(body.data, body),
        raw: body,
    };
}

export function parseResponse(text: string, operation: string): unknown {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new DingTalkError(`钉钉 ${operation} 返回了无效 JSON`, {
            code: "DINGTALK_RESPONSE_JSON_INVALID",
            category: ErrorCategory.PROTOCOL,
            details: { operation },
            cause: error,
        });
    }
}

export function extractApiError(
    value: unknown,
): { code: string | number; message: string; requestId?: string } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const data = value as Record<string, unknown>;
    const legacyCode = typeof data.errcode === "number" ? data.errcode : undefined;
    const modernCode = typeof data.code === "string" ? data.code : undefined;
    if ((!legacyCode || legacyCode === 0) && !modernCode) return undefined;
    return {
        code: modernCode || legacyCode || "UNKNOWN",
        message: String(data.message || data.errmsg || "钉钉 API 调用失败"),
        requestId: stringValue(data.requestid || data.requestId),
    };
}

export function parseObject(text: string, description: string): Record<string, unknown> {
    return objectValue(parseResponse(text, description), description);
}

export function tryParseObject(text: string): Record<string, unknown> | undefined {
    try {
        const value: unknown = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : undefined;
    } catch {
        // URL 校验的 challenge 是普通字符串，并非 JSON。
        return undefined;
    }
}

export function objectValue(value: unknown, description: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw DingTalkError.invalid(`${description} 必须为对象`, "DINGTALK_OBJECT_REQUIRED", {
            description,
        });
    }
    return value as Record<string, unknown>;
}

export function queryString(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return "";
}

export function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

export function isRobotMessage(value: Record<string, unknown>): value is DingTalkRobotMessage {
    return (
        typeof value.msgId === "string" &&
        typeof value.conversationId === "string" &&
        typeof value.conversationType === "string" &&
        typeof value.msgtype === "string" &&
        typeof value.senderId === "string" &&
        typeof value.createAt === "number"
    );
}

function objectOrSelf(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fallback;
}
