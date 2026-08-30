import { QQApiError } from "./errors.js";
import type { QQActionHandler, QQActionParams } from "./platform-action-context.js";

/** QQ 开放平台仅对 C2C 开放的 replace-mode 流式消息生命周期。 */
export const QQ_STREAM_ACTIONS = {
    start_c2c_stream: async (client, params) => {
        assertFields(params, ["target_id", "msg_id", "event_id", "throttle_ms", "content"]);
        const stream = client.startC2CStream({
            targetId: strictString(params, "target_id"),
            msgId: strictString(params, "msg_id"),
            eventId: optionalStrictString(params.event_id, "event_id"),
            throttleMs: optionalThrottle(params.throttle_ms),
        });
        const content = optionalContent(params.content);
        if (content === undefined) return { stream_id: stream };
        try {
            await client.updateC2CStream(stream, content);
            return { stream_id: stream };
        } catch (error) {
            client.cancelC2CStream(stream);
            throw error;
        }
    },
    update_c2c_stream: async (client, params) => {
        assertFields(params, ["stream_id", "content"]);
        return client.updateC2CStream(
            strictString(params, "stream_id"),
            requiredContent(params.content),
        );
    },
    complete_c2c_stream: async (client, params) => {
        assertFields(params, ["stream_id", "content"]);
        const streamId = strictString(params, "stream_id");
        const content = optionalContent(params.content);
        if (content !== undefined) await client.updateC2CStream(streamId, content);
        return client.completeC2CStream(streamId);
    },
    cancel_c2c_stream: async (client, params) => {
        assertFields(params, ["stream_id"]);
        return client.cancelC2CStream(strictString(params, "stream_id"));
    },
} satisfies Readonly<Record<string, QQActionHandler>>;

function assertFields(params: QQActionParams, allowed: readonly string[]): void {
    const unknown = Object.keys(params).filter(key => !allowed.includes(key));
    if (unknown.length) throw invalidStreamParam(`包含未知参数: ${unknown.join("、")}`);
}

function strictString(params: QQActionParams, key: string): string {
    const value = optionalStrictString(params[key], key);
    if (value === undefined) throw invalidStreamParam(`${key} 必须是非空字符串`);
    return value;
}

function optionalStrictString(value: unknown, key: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value) {
        throw invalidStreamParam(`${key} 必须是非空字符串`);
    }
    return value;
}

function optionalThrottle(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 300 ||
        value > 60_000
    ) {
        throw invalidStreamParam("throttle_ms 必须是 300 到 60000 之间的安全整数");
    }
    return value;
}

function optionalContent(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    return requiredContent(value);
}

function requiredContent(value: unknown): string {
    if (typeof value !== "string") throw invalidStreamParam("content 必须是完整文本字符串");
    return value;
}

function invalidStreamParam(message: string): QQApiError {
    return QQApiError.invalid(message, "QQ_INVALID_ACTION_PARAMS");
}
