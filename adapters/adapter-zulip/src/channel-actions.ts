import type { PlatformActionHandler } from "onebots";
import {
    exactParams,
    requireBoolean,
    requireInteger,
    requireParams,
    requireString,
    requireText,
    without,
} from "./action-params.js";
import {
    channelSubscribeParams,
    channelSubscriptionsUpdateParams,
    channelUnsubscribeParams,
    channelUpdateParams,
} from "./channel-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

const LIST_FIELDS = [
    "include_public",
    "include_web_public",
    "include_subscribed",
    "exclude_archived",
    "include_all",
    "include_default",
    "include_owner_subscribed",
    "include_can_access_content",
] as const;
const BOOLEAN_SUBSCRIPTION_PROPERTIES = new Set([
    "is_muted",
    "pin_to_top",
    "desktop_notifications",
    "audible_notifications",
    "push_notifications",
    "email_notifications",
    "wildcard_mentions_notify",
]);

export const ZULIP_CHANNEL_ADMIN_ACTIONS: ReadonlySet<string> = new Set([
    "create_zulip_channel",
    "update_zulip_channel",
    "archive_channel",
    "unarchive_channel",
    "delete_channel_topic",
]);

/** Zulip 频道、话题与订阅资源动作。 */
export const ZULIP_CHANNEL_ACTION_HANDLERS = {
    get_channel_id: (client, params) => {
        const input = exactParams(params, ["stream"], ["stream"]);
        requireString(input.stream, "stream");
        return client.call("get_stream_id", "GET", input);
    },
    get_channel_topics: (client, params) => {
        const input = exactParams(params, ["stream_id", "allow_empty_topic_name"], ["stream_id"]);
        const streamId = requireInteger(input.stream_id, "stream_id");
        const query = without(input, "stream_id");
        if (query.allow_empty_topic_name !== undefined) {
            requireBoolean(query.allow_empty_topic_name, "allow_empty_topic_name");
        }
        return client.call(`users/me/${streamId}/topics`, "GET", query);
    },
    get_channel_subscriptions: (client, params) => {
        const input = exactParams(params, ["include_subscribers"]);
        if (input.include_subscribers !== undefined) {
            requireBoolean(input.include_subscribers, "include_subscribers");
        }
        return client.call("users/me/subscriptions", "GET", input);
    },
    get_channel_subscription_status: (client, params) => {
        const input = exactParams(params, ["user_id", "stream_id"], ["user_id", "stream_id"]);
        const userId = requireInteger(input.user_id, "user_id");
        const streamId = requireInteger(input.stream_id, "stream_id");
        return client.call(`users/${userId}/subscriptions/${streamId}`);
    },
    get_user_channels: (client, params) => {
        const input = exactParams(params, ["user_id"], ["user_id"]);
        return client.call(`users/${requireInteger(input.user_id, "user_id")}/channels`);
    },
    list_zulip_channels: (client, params) => {
        const input = exactParams(params, LIST_FIELDS);
        for (const field of LIST_FIELDS) {
            if (input[field] !== undefined) requireBoolean(input[field], field);
        }
        return client.call("streams", "GET", input);
    },
    get_zulip_channel: (client, params) => client.call(`streams/${onlyStreamId(params)}`),
    get_channel_email_address: (client, params) => {
        const input = exactParams(params, ["stream_id", "sender_id"], ["stream_id"]);
        const streamId = requireInteger(input.stream_id, "stream_id");
        const query = without(input, "stream_id");
        if (query.sender_id !== undefined) requireInteger(query.sender_id, "sender_id");
        return client.call(`streams/${streamId}/email_address`, "GET", query);
    },
    update_channel_subscription_settings: (client, params) => {
        const input = exactParams(params, ["subscription_data"], ["subscription_data"]);
        validateSubscriptionData(input.subscription_data);
        return client.call("users/me/subscriptions/properties", "POST", input);
    },
    update_channel_subscription_property: (client, params) => {
        const input = exactParams(
            params,
            ["stream_id", "property", "value"],
            ["stream_id", "property", "value"],
        );
        const streamId = requireInteger(input.stream_id, "stream_id");
        validateSubscriptionProperty(input.property, input.value);
        return client.call(`users/me/subscriptions/${streamId}`, "PATCH", {
            property: input.property,
            value: input.value,
        });
    },
    delete_channel_topic: (client, params) => {
        const input = exactParams(params, ["stream_id", "topic_name"], ["stream_id", "topic_name"]);
        const streamId = requireInteger(input.stream_id, "stream_id");
        const topicName = requireText(input.topic_name, "topic_name");
        return client.call(`streams/${streamId}/delete_topic`, "POST", {
            topic_name: topicName,
        });
    },
    subscribe_channels: (client, params) =>
        client.call("users/me/subscriptions", "POST", channelSubscribeParams(params)),
    update_channel_subscriptions: (client, params) =>
        client.call("users/me/subscriptions", "PATCH", channelSubscriptionsUpdateParams(params)),
    unsubscribe_channels: (client, params) =>
        client.call("users/me/subscriptions", "DELETE", channelUnsubscribeParams(params)),
    get_channel_subscribers: (client, params) =>
        client.call(`streams/${onlyStreamId(params)}/members`),
    create_zulip_channel: (client, params) =>
        client.call("channels/create", "POST", requireParams(params)),
    update_zulip_channel: (client, params) => {
        const streamId = requireInteger(params.stream_id, "stream_id");
        return client.call(
            `streams/${streamId}`,
            "PATCH",
            channelUpdateParams(without(params, "stream_id")),
        );
    },
    archive_channel: (client, params) => client.call(`streams/${onlyStreamId(params)}`, "DELETE"),
    unarchive_channel: (client, params) =>
        client.call(`streams/${onlyStreamId(params)}`, "PATCH", { is_archived: false }),
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function onlyStreamId(params: Readonly<Record<string, unknown>>): number {
    const input = exactParams(params, ["stream_id"], ["stream_id"]);
    return requireInteger(input.stream_id, "stream_id");
}

function validateSubscriptionData(value: unknown): void {
    if (!Array.isArray(value) || !value.length) {
        throwInvalid("Zulip 参数 subscription_data 必须是非空数组");
    }
    for (const [index, item] of value.entries()) {
        if (!isRecord(item)) {
            throwInvalid(`Zulip subscription_data[${index}] 必须是对象`);
        }
        if (
            Object.keys(item).some(
                key => key !== "stream_id" && key !== "property" && key !== "value",
            )
        ) {
            throwInvalid(`Zulip subscription_data[${index}] 包含未知字段`);
        }
        requireInteger(item.stream_id, `subscription_data[${index}].stream_id`);
        validateSubscriptionProperty(item.property, item.value, `subscription_data[${index}]`);
    }
}

function validateSubscriptionProperty(
    value: unknown,
    setting: unknown,
    name = "subscription",
): void {
    const property = requireString(value, `${name}.property`);
    if (property === "color") {
        const color = requireString(setting, `${name}.value`);
        if (!/^#[0-9a-f]{6}$/i.test(color)) {
            throwInvalid(`Zulip ${name}.value 必须是 6 位十六进制颜色`);
        }
        return;
    }
    if (!BOOLEAN_SUBSCRIPTION_PROPERTIES.has(property)) {
        throwInvalid(`Zulip ${name}.property 不是现代订阅属性`);
    }
    requireBoolean(setting, `${name}.value`);
}

function throwInvalid(message: string): never {
    throw new ZulipError(message, { code: "ZULIP_INVALID_ACTION_PARAM" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
