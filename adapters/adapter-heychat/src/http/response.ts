import { ErrorCategory } from "onebots";
import { HeychatApiError } from "../errors.js";
import type { HeychatApiResponse, HeychatRoomInfo, HeychatSendMessageResult } from "../types.js";

/** REST 与 OAuth 共用的平台响应边界。 */
export function parseHeychatResponse(text: string, path: string): HeychatApiResponse {
    if (!text) return {};
    try {
        const value = JSON.parse(text) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            return value as HeychatApiResponse;
        }
    } catch (error) {
        throw new HeychatApiError("黑盒语音响应不是有效 JSON", {
            code: "HEYCHAT_INVALID_RESPONSE",
            category: ErrorCategory.PROTOCOL,
            path,
            details: text.slice(0, 500),
            cause: error,
        });
    }
    throw new HeychatApiError("黑盒语音响应结构无效", {
        code: "HEYCHAT_INVALID_RESPONSE",
        category: ErrorCategory.PROTOCOL,
        path,
        details: text.slice(0, 500),
    });
}

export function isSuccessfulHeychatPayload(payload: HeychatApiResponse): boolean {
    return (
        payload.status === undefined ||
        payload.status === true ||
        payload.status === "true" ||
        payload.status === "ok"
    );
}

export function heychatPlatformMessage(payload: HeychatApiResponse): string {
    return typeof payload.msg === "string"
        ? payload.msg
        : typeof payload.message === "string"
          ? payload.message
          : "";
}

export function projectMessageResult(
    result: Record<string, unknown>,
    ackId: string,
): HeychatSendMessageResult {
    return {
        msg_id: String(result.msg_id || result.chatmobile_ack_id || result.heychat_ack_id || ackId),
        heychat_ack_id: String(result.heychat_ack_id || ackId),
    };
}

export function numericHeychatId(value: string, name: string): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 0) {
        throw HeychatApiError.invalid(`${name} 必须是安全整数 ID`, "HEYCHAT_INVALID_ID", value);
    }
    return id;
}

export function normalizeRoomInfo(
    room: Partial<HeychatRoomInfo>,
    fallbackRoomId: string,
): HeychatRoomInfo {
    return {
        ...room,
        room_id: String(room.room_id || fallbackRoomId),
        room_name: stringProperty(room, "room_name", "name"),
        room_avatar: stringProperty(room, "room_avatar", "avatar"),
        member_count: numberProperty(room, "member_count", "user_count"),
    };
}

function stringProperty(value: object, ...keys: string[]): string | undefined {
    const record = value as Record<string, unknown>;
    for (const key of keys) if (typeof record[key] === "string") return record[key];
    return undefined;
}

function numberProperty(value: object, ...keys: string[]): number | undefined {
    const record = value as Record<string, unknown>;
    for (const key of keys) if (typeof record[key] === "number") return record[key];
    return undefined;
}
