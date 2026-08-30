import type { PlatformActionHandler } from "onebots";
import {
    assertHasAny,
    exactParams,
    requireBoolean,
    requireInteger,
    requireIntegerArray,
    requireString,
    requireText,
    without,
} from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";
import type { ZulipParams } from "./types.js";

const MESSAGE_FIELDS = ["type", "to", "content", "topic", "scheduled_delivery_timestamp"] as const;

/** Zulip 定时消息资源动作，仅接受现代 direct/channel 请求场景。 */
export const ZULIP_SCHEDULED_MESSAGE_ACTION_HANDLERS = {
    get_scheduled_messages: client => client.call("scheduled_messages"),
    create_scheduled_message: (client, params) =>
        client.call("scheduled_messages", "POST", scheduledMessageCreateParams(params)),
    edit_scheduled_message: (client, params) => {
        const input = exactParams(
            params,
            ["scheduled_message_id", ...MESSAGE_FIELDS],
            ["scheduled_message_id"],
        );
        const id = requireInteger(input.scheduled_message_id, "scheduled_message_id");
        return client.call(
            `scheduled_messages/${id}`,
            "PATCH",
            scheduledMessageUpdateParams(without(input, "scheduled_message_id")),
        );
    },
    delete_scheduled_message: (client, params) => {
        const input = exactParams(params, ["scheduled_message_id"], ["scheduled_message_id"]);
        return client.call(
            `scheduled_messages/${requireInteger(input.scheduled_message_id, "scheduled_message_id")}`,
            "DELETE",
        );
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function scheduledMessageCreateParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const input = exactParams(
        params,
        [...MESSAGE_FIELDS, "read_by_sender"],
        ["type", "to", "content", "scheduled_delivery_timestamp"],
    );
    validateMessage(input, true);
    if (input.read_by_sender !== undefined) requireBoolean(input.read_by_sender, "read_by_sender");
    return input;
}

function scheduledMessageUpdateParams(params: Readonly<Record<string, unknown>>): ZulipParams {
    const input = exactParams(params, MESSAGE_FIELDS);
    assertHasAny(input, MESSAGE_FIELDS);
    validateMessage(input, false);
    return input;
}

function validateMessage(input: ZulipParams, create: boolean): void {
    const type = input.type === undefined ? undefined : requireString(input.type, "type");
    if (type !== undefined && type !== "direct" && type !== "channel") {
        invalid("Zulip 参数 type 必须使用现代 direct 或 channel");
    }
    if (!create && type !== undefined && input.to === undefined) {
        invalid("Zulip 更新 type 时必须同时提供 to");
    }
    if (input.to !== undefined) validateTarget(input.to, type);
    if (input.content !== undefined) requireString(input.content, "content");
    if (input.scheduled_delivery_timestamp !== undefined) {
        requireInteger(input.scheduled_delivery_timestamp, "scheduled_delivery_timestamp");
    }
    if (type === "channel" && input.topic === undefined) {
        invalid("Zulip channel 定时消息必须提供 topic");
    }
    if (type === "direct" && input.topic !== undefined) {
        invalid("Zulip direct 定时消息不接受 topic");
    }
    if (input.topic !== undefined) requireText(input.topic, "topic");
}

function validateTarget(value: unknown, type: string | undefined): void {
    if (type === "channel") {
        requireInteger(value, "to");
        return;
    }
    if (type === "direct") {
        requireRecipients(value);
        return;
    }
    if (Array.isArray(value)) {
        requireRecipients(value);
        return;
    }
    requireInteger(value, "to");
}

function requireRecipients(value: unknown): void {
    const recipients = requireIntegerArray(value, "to");
    if (!recipients.length) invalid("Zulip 参数 to 必须包含至少一个用户 ID");
}

function invalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}
