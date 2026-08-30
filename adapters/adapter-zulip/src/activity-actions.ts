import type { PlatformActionHandler } from "onebots";
import {
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireText,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

/** Zulip Presence、输入状态与个人话题可见性动作。 */
export const ZULIP_ACTIVITY_ACTION_HANDLERS = {
    set_topic_visibility: (client, params) => {
        const input = exactParams(
            params,
            ["stream_id", "topic", "visibility_policy"],
            ["stream_id", "topic", "visibility_policy"],
        );
        requireInteger(input.stream_id, "stream_id");
        requireText(input.topic, "topic");
        const policy = requireInteger(input.visibility_policy, "visibility_policy");
        if (policy > 3) invalid("Zulip 参数 visibility_policy 必须是 0、1、2 或 3");
        return client.call("user_topics", "POST", input);
    },
    update_presence: (client, params) => {
        const input = exactParams(
            params,
            ["status", "last_update_id", "history_limit_days", "new_user_input", "ping_only"],
            ["status"],
        );
        const status = requireString(input.status, "status");
        if (status !== "active" && status !== "idle")
            invalid("Zulip 参数 status 必须是 active 或 idle");
        if (input.last_update_id !== undefined) validateLastUpdateId(input.last_update_id);
        if (input.history_limit_days !== undefined)
            requireInteger(input.history_limit_days, "history_limit_days");
        for (const field of ["new_user_input", "ping_only"] as const) {
            if (input[field] !== undefined) requireBoolean(input[field], field);
        }
        return client.call("users/me/presence", "POST", input);
    },
    get_user_presence: (client, params) => {
        const input = exactParams(params, ["user_id_or_email"], ["user_id_or_email"]);
        const user = requireString(input.user_id_or_email, "user_id_or_email");
        return client.call(`users/${encodeURIComponent(user)}/presence`);
    },
    send_typing_notification: (client, params) => {
        const input = exactParams(params, ["type", "op", "to", "stream_id", "topic"], ["op"]);
        validateTyping(input);
        return client.call("typing", "POST", input);
    },
    send_message_edit_typing_notification: (client, params) => {
        const input = exactParams(params, ["message_id", "op"], ["message_id", "op"]);
        const messageId = requireInteger(input.message_id, "message_id");
        validateTypingOp(input.op);
        return client.call(`messages/${messageId}/typing`, "POST", { op: input.op });
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function validateLastUpdateId(value: unknown): void {
    if (value === -1) return;
    requireInteger(value, "last_update_id");
}

function validateTyping(input: Readonly<Record<string, unknown>>): void {
    validateTypingOp(input.op);
    const type = input.type === undefined ? "direct" : requireString(input.type, "type");
    if (type !== "direct" && type !== "channel")
        invalid("Zulip 参数 type 必须使用现代 direct 或 channel");
    if (type === "direct") {
        const recipients = requireIntegerArray(input.to, "to");
        if (!recipients.length) invalid("Zulip direct 输入状态必须包含接收者");
        if (input.stream_id !== undefined || input.topic !== undefined)
            invalid("Zulip direct 输入状态不接受频道字段");
        return;
    }
    requireInteger(input.stream_id, "stream_id");
    requireText(input.topic, "topic");
    if (input.to !== undefined) invalid("Zulip channel 输入状态不接受 to");
}

function validateTypingOp(value: unknown): void {
    const op = requireString(value, "op");
    if (op !== "start" && op !== "stop") invalid("Zulip 参数 op 必须是 start 或 stop");
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
