import type { ReplyTarget } from "@tencent-connect/qqbot-nodejs";
import { QQApiError } from "./errors.js";
import type { QQPlatformCall } from "./types.js";
import type { QQActionParams } from "./platform-action-context.js";

export function target(params: QQActionParams): ReplyTarget {
    const scope = requiredString(params, "scope");
    if (scope !== "c2c" && scope !== "group") throw invalid("scope 必须是 c2c 或 group");
    return {
        scope,
        targetId: requiredString(params, "target_id"),
        msgId: optionalString(params.msg_id),
    };
}

export function readPlatformCall(params: QQActionParams): QQPlatformCall {
    const method = requiredString(params, "method").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw invalid("method 非法");
    }
    return {
        method: method as QQPlatformCall["method"],
        path: requiredString(params, "path"),
        query: optionalQuery(params.query),
        body: params.body,
    };
}

export function reactionPath(params: QQActionParams): string {
    return `/channels/${requiredString(params, "channel_id")}/messages/${requiredString(params, "message_id")}/reactions/${requiredString(params, "emoji_type")}/${requiredString(params, "emoji_id")}`;
}

export function schedulePath(params: QQActionParams): string {
    return `/channels/${requiredString(params, "channel_id")}/schedules/${requiredString(params, "schedule_id")}`;
}

export function threadPath(params: QQActionParams): string {
    return `/channels/${requiredString(params, "channel_id")}/threads/${requiredString(params, "thread_id")}`;
}

export function requiredString(params: QQActionParams, key: string): string {
    const value = optionalString(params[key]);
    if (!value) throw invalid(`缺少 ${key}`);
    return value;
}

export function optionalString(value: unknown): string | undefined {
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
    if (value == null) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) throw invalid("数字参数非法");
    return number;
}

export function optionalRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

export function optionalQuery(value: unknown): QQPlatformCall["query"] {
    if (value == null) return undefined;
    const record = optionalRecord(value);
    if (!record) throw invalid("query 必须是对象");
    const query: NonNullable<QQPlatformCall["query"]> = {};
    for (const [key, item] of Object.entries(record)) {
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
            throw invalid(`query 参数 ${key} 必须是字符串、数字或布尔值`);
        }
        query[key] = item;
    }
    return query;
}

export function requiredRecord(params: QQActionParams, key: string): Record<string, unknown> {
    const value = optionalRecord(params[key]);
    if (!value) throw invalid(`缺少对象参数 ${key}`);
    return value;
}

export function requiredArray(params: QQActionParams, key: string): unknown[] {
    const value = params[key];
    if (!Array.isArray(value)) throw invalid(`缺少数组参数 ${key}`);
    return value;
}

function invalid(message: string): QQApiError {
    return QQApiError.invalid(message, "QQ_INVALID_ACTION_PARAMS");
}
