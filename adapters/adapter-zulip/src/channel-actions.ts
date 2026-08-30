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
import type { ZulipClient } from "./client.js";

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
    delete_channel_topic: (client, params) => {
        const input = exactParams(params, ["stream_id", "topic_name"], ["stream_id", "topic_name"]);
        const streamId = requireInteger(input.stream_id, "stream_id");
        const topicName = requireText(input.topic_name, "topic_name");
        return client.call(`streams/${streamId}/delete_topic`, "POST", {
            topic_name: topicName,
        });
    },
    subscribe_channels: (client, params) =>
        client.call("users/me/subscriptions", "POST", requireParams(params)),
    unsubscribe_channels: (client, params) =>
        client.call("users/me/subscriptions", "DELETE", requireParams(params)),
    get_channel_subscribers: (client, params) =>
        client.call(`streams/${onlyStreamId(params)}/members`),
    create_zulip_channel: (client, params) =>
        client.call("channels/create", "POST", requireParams(params)),
    update_zulip_channel: (client, params) => {
        const streamId = requireInteger(params.stream_id, "stream_id");
        return client.call(`streams/${streamId}`, "PATCH", without(params, "stream_id"));
    },
    archive_channel: (client, params) => client.call(`streams/${onlyStreamId(params)}`, "DELETE"),
    unarchive_channel: (client, params) =>
        client.call(`streams/${onlyStreamId(params)}`, "PATCH", { is_archived: false }),
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function onlyStreamId(params: Readonly<Record<string, unknown>>): number {
    const input = exactParams(params, ["stream_id"], ["stream_id"]);
    return requireInteger(input.stream_id, "stream_id");
}
