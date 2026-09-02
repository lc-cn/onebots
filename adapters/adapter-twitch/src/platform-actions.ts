import { definePlatformActionContract, type PlatformActionHandler } from "onebots";
import {
    optionalBoolean,
    optionalId,
    optionalInteger,
    optionalString,
    parseQuery,
    requireId,
    requireMethod,
    requireObject,
    requireString,
    requireStringArray,
} from "./action-params.js";
import type { TwitchClient } from "./client.js";
import { normalizeSubscription } from "./configuration.js";
import { TwitchError } from "./errors.js";

const handlers = {
    call_twitch_api: (client, params) =>
        client.call(requireMethod(params.method), requireString(params.path, "path"), {
            query: parseQuery(params.query),
            body: params.body,
        }),
    get_twitch_users: (client, params) =>
        client.getUsers({
            ids:
                params.user_ids === undefined
                    ? undefined
                    : requireStringArray(params.user_ids, "user_ids"),
            logins:
                params.logins === undefined
                    ? undefined
                    : requireStringArray(params.logins, "logins"),
        }),
    get_twitch_channels: (client, params) =>
        client.getChannels(requireStringArray(params.broadcaster_ids, "broadcaster_ids")),
    modify_twitch_channel: (client, params) =>
        client.call("PATCH", "channels", {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
            body: requireObject(params.channel, "channel"),
        }),
    get_twitch_streams: (client, params) =>
        client.call("GET", "streams", { query: parseQuery(params.query) }),
    create_twitch_clip: (client, params) =>
        client.call("POST", "clips", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                has_delay: optionalBoolean(params.has_delay, "has_delay"),
            },
        }),
    get_twitch_clips: (client, params) =>
        client.call("GET", "clips", { query: parseQuery(params.query) }),
    send_twitch_chat_message: (client, params) =>
        client.sendChatMessage(
            requireId(params.broadcaster_id, "broadcaster_id"),
            requireString(params.message, "message", 500),
            {
                senderId: optionalId(params.sender_id, "sender_id"),
                replyParentMessageId: optionalString(
                    params.reply_parent_message_id,
                    "reply_parent_message_id",
                    255,
                ),
            },
        ),
    send_twitch_announcement: (client, params) =>
        client.sendAnnouncement(
            requireId(params.broadcaster_id, "broadcaster_id"),
            requireId(params.moderator_id, "moderator_id"),
            requireString(params.message, "message", 500),
            announcementColor(params.color),
        ),
    send_twitch_whisper: (client, params) =>
        client.sendWhisper(
            requireId(params.to_user_id, "to_user_id"),
            requireString(params.message, "message", 500),
            optionalId(params.from_user_id, "from_user_id"),
        ),
    get_twitch_chatters: (client, params) =>
        client.getAllChatters(
            requireId(params.broadcaster_id, "broadcaster_id"),
            requireId(params.moderator_id, "moderator_id"),
        ),
    get_twitch_chat_settings: (client, params) =>
        client.call("GET", "chat/settings", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                moderator_id: optionalId(params.moderator_id, "moderator_id"),
            },
        }),
    update_twitch_chat_settings: (client, params) =>
        client.call("PATCH", "chat/settings", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                moderator_id: requireId(params.moderator_id, "moderator_id"),
            },
            body: requireObject(params.settings, "settings"),
        }),
    delete_twitch_chat_messages: (client, params) =>
        client.deleteChatMessage(
            requireId(params.broadcaster_id, "broadcaster_id"),
            requireId(params.moderator_id, "moderator_id"),
            optionalString(params.message_id, "message_id", 255),
        ),
    ban_twitch_user: (client, params) =>
        client.banUser(
            requireId(params.broadcaster_id, "broadcaster_id"),
            requireId(params.moderator_id, "moderator_id"),
            requireId(params.user_id, "user_id"),
            {
                duration: optionalInteger(params.duration, "duration", 1, 1_209_600),
                reason: optionalString(params.reason, "reason", 500),
            },
        ),
    unban_twitch_user: (client, params) =>
        client.unbanUser(
            requireId(params.broadcaster_id, "broadcaster_id"),
            requireId(params.moderator_id, "moderator_id"),
            requireId(params.user_id, "user_id"),
        ),
    warn_twitch_user: (client, params) =>
        client.call("POST", "moderation/warnings", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                moderator_id: requireId(params.moderator_id, "moderator_id"),
            },
            body: {
                data: {
                    user_id: requireId(params.user_id, "user_id"),
                    reason: requireString(params.reason, "reason", 500),
                },
            },
        }),
    get_twitch_moderators: (client, params) =>
        client.call("GET", "moderation/moderators", { query: parseQuery(params.query) }),
    add_twitch_moderator: (client, params) =>
        client.call("POST", "moderation/moderators", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                user_id: requireId(params.user_id, "user_id"),
            },
        }),
    remove_twitch_moderator: (client, params) =>
        client.call("DELETE", "moderation/moderators", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                user_id: requireId(params.user_id, "user_id"),
            },
        }),
    get_twitch_vips: (client, params) =>
        client.call("GET", "channels/vips", { query: parseQuery(params.query) }),
    add_twitch_vip: (client, params) =>
        client.call("POST", "channels/vips", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                user_id: requireId(params.user_id, "user_id"),
            },
        }),
    remove_twitch_vip: (client, params) =>
        client.call("DELETE", "channels/vips", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                user_id: requireId(params.user_id, "user_id"),
            },
        }),
    get_twitch_blocked_terms: (client, params) =>
        client.call("GET", "moderation/blocked_terms", { query: parseQuery(params.query) }),
    add_twitch_blocked_term: (client, params) =>
        client.call("POST", "moderation/blocked_terms", {
            query: moderationQuery(params),
            body: { text: requireString(params.text, "text", 500) },
        }),
    remove_twitch_blocked_term: (client, params) =>
        client.call("DELETE", "moderation/blocked_terms", {
            query: { ...moderationQuery(params), id: requireString(params.id, "id", 255) },
        }),
    check_twitch_automod_status: (client, params) =>
        client.call("POST", "moderation/enforcements/status", {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
            body: { data: params.messages },
        }),
    manage_twitch_held_automod_message: (client, params) =>
        client.call("POST", "moderation/automod/message", {
            body: {
                user_id: requireId(params.user_id, "user_id"),
                msg_id: requireString(params.message_id, "message_id", 255),
                action: enumValue(params.action, "action", ["ALLOW", "DENY"]),
            },
        }),
    get_twitch_custom_rewards: (client, params) =>
        client.call("GET", "channel_points/custom_rewards", { query: parseQuery(params.query) }),
    create_twitch_custom_reward: (client, params) =>
        client.call("POST", "channel_points/custom_rewards", {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
            body: requireObject(params.reward, "reward"),
        }),
    update_twitch_custom_reward: (client, params) =>
        client.call("PATCH", "channel_points/custom_rewards", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                id: requireString(params.reward_id, "reward_id", 255),
            },
            body: requireObject(params.reward, "reward"),
        }),
    delete_twitch_custom_reward: (client, params) =>
        client.call("DELETE", "channel_points/custom_rewards", {
            query: {
                broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
                id: requireString(params.reward_id, "reward_id", 255),
            },
        }),
    get_twitch_reward_redemptions: (client, params) =>
        client.call("GET", "channel_points/custom_rewards/redemptions", {
            query: parseQuery(params.query),
        }),
    update_twitch_reward_redemptions: (client, params) =>
        client.call("PATCH", "channel_points/custom_rewards/redemptions", {
            query: parseQuery(params.query),
            body: { status: enumValue(params.status, "status", ["CANCELED", "FULFILLED"]) },
        }),
    get_twitch_polls: resourceGet("polls"),
    create_twitch_poll: resourceCreate("polls", "poll"),
    end_twitch_poll: resourcePatch("polls", "poll"),
    get_twitch_predictions: resourceGet("predictions"),
    create_twitch_prediction: resourceCreate("predictions", "prediction"),
    resolve_twitch_prediction: resourcePatch("predictions", "prediction"),
    start_twitch_raid: (client, params) =>
        client.call("POST", "raids", {
            query: {
                from_broadcaster_id: requireId(params.from_broadcaster_id, "from_broadcaster_id"),
                to_broadcaster_id: requireId(params.to_broadcaster_id, "to_broadcaster_id"),
            },
        }),
    cancel_twitch_raid: (client, params) =>
        client.call("DELETE", "raids", {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
        }),
    get_twitch_schedule: (client, params) =>
        client.call("GET", "schedule", { query: parseQuery(params.query) }),
    update_twitch_schedule: (client, params) =>
        client.call("PATCH", "schedule/settings", {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
            body: requireObject(params.settings, "settings"),
        }),
    get_twitch_videos: (client, params) =>
        client.call("GET", "videos", { query: parseQuery(params.query) }),
    delete_twitch_videos: (client, params) =>
        client.call("DELETE", "videos", {
            query: { id: requireStringArray(params.video_ids, "video_ids", 5) },
        }),
    get_twitch_games: (client, params) =>
        client.call("GET", "games", { query: parseQuery(params.query) }),
    get_twitch_channel_emotes: (client, params) =>
        client.call("GET", "chat/emotes", {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
        }),
    get_twitch_global_emotes: client => client.call("GET", "chat/emotes/global"),
    get_twitch_user_emotes: (client, params) =>
        client.call("GET", "chat/emotes/user", { query: parseQuery(params.query) }),
    get_twitch_cheermotes: (client, params) =>
        client.call("GET", "bits/cheermotes", {
            query: { broadcaster_id: optionalId(params.broadcaster_id, "broadcaster_id") },
        }),
    create_twitch_eventsub_subscription: (client, params) => {
        const subscription = normalizeSubscription(
            {
                type: requireString(params.type, "type", 100),
                version: optionalString(params.version, "version", 10),
                ...conditionParams(requireObject(params.condition, "condition")),
            },
            client.config,
        );
        return client.createEventSubSubscription({
            ...subscription,
            transport: requireObject(params.transport, "transport"),
        });
    },
    list_twitch_eventsub_subscriptions: (client, params) =>
        client.listEventSubSubscriptions({
            status: optionalString(params.status, "status", 100),
            type: optionalString(params.type, "type", 100),
            userId: optionalId(params.user_id, "user_id"),
            after: optionalString(params.after, "after", 255),
        }),
    delete_twitch_eventsub_subscription: (client, params) =>
        client.deleteEventSubSubscription(requireString(params.id, "id", 255)),
} satisfies Readonly<Record<string, PlatformActionHandler<TwitchClient>>>;

const parameters = {
    call_twitch_api: ["method", "path", "query", "body"],
    get_twitch_users: ["user_ids", "logins"],
    get_twitch_channels: ["broadcaster_ids"],
    modify_twitch_channel: ["broadcaster_id", "channel"],
    get_twitch_streams: ["query"],
    create_twitch_clip: ["broadcaster_id", "has_delay"],
    get_twitch_clips: ["query"],
    send_twitch_chat_message: ["broadcaster_id", "sender_id", "message", "reply_parent_message_id"],
    send_twitch_announcement: ["broadcaster_id", "moderator_id", "message", "color"],
    send_twitch_whisper: ["from_user_id", "to_user_id", "message"],
    get_twitch_chatters: ["broadcaster_id", "moderator_id"],
    get_twitch_chat_settings: ["broadcaster_id", "moderator_id"],
    update_twitch_chat_settings: ["broadcaster_id", "moderator_id", "settings"],
    delete_twitch_chat_messages: ["broadcaster_id", "moderator_id", "message_id"],
    ban_twitch_user: ["broadcaster_id", "moderator_id", "user_id", "duration", "reason"],
    unban_twitch_user: ["broadcaster_id", "moderator_id", "user_id"],
    warn_twitch_user: ["broadcaster_id", "moderator_id", "user_id", "reason"],
    get_twitch_moderators: ["query"],
    add_twitch_moderator: ["broadcaster_id", "user_id"],
    remove_twitch_moderator: ["broadcaster_id", "user_id"],
    get_twitch_vips: ["query"],
    add_twitch_vip: ["broadcaster_id", "user_id"],
    remove_twitch_vip: ["broadcaster_id", "user_id"],
    get_twitch_blocked_terms: ["query"],
    add_twitch_blocked_term: ["broadcaster_id", "moderator_id", "text"],
    remove_twitch_blocked_term: ["broadcaster_id", "moderator_id", "id"],
    check_twitch_automod_status: ["broadcaster_id", "messages"],
    manage_twitch_held_automod_message: ["user_id", "message_id", "action"],
    get_twitch_custom_rewards: ["query"],
    create_twitch_custom_reward: ["broadcaster_id", "reward"],
    update_twitch_custom_reward: ["broadcaster_id", "reward_id", "reward"],
    delete_twitch_custom_reward: ["broadcaster_id", "reward_id"],
    get_twitch_reward_redemptions: ["query"],
    update_twitch_reward_redemptions: ["query", "status"],
    get_twitch_polls: ["query"],
    create_twitch_poll: ["broadcaster_id", "poll"],
    end_twitch_poll: ["broadcaster_id", "poll"],
    get_twitch_predictions: ["query"],
    create_twitch_prediction: ["broadcaster_id", "prediction"],
    resolve_twitch_prediction: ["broadcaster_id", "prediction"],
    start_twitch_raid: ["from_broadcaster_id", "to_broadcaster_id"],
    cancel_twitch_raid: ["broadcaster_id"],
    get_twitch_schedule: ["query"],
    update_twitch_schedule: ["broadcaster_id", "settings"],
    get_twitch_videos: ["query"],
    delete_twitch_videos: ["video_ids"],
    get_twitch_games: ["query"],
    get_twitch_channel_emotes: ["broadcaster_id"],
    get_twitch_global_emotes: [],
    get_twitch_user_emotes: ["query"],
    get_twitch_cheermotes: ["broadcaster_id"],
    create_twitch_eventsub_subscription: ["type", "version", "condition", "transport"],
    list_twitch_eventsub_subscriptions: ["status", "type", "user_id", "after"],
    delete_twitch_eventsub_subscription: ["id"],
} satisfies { readonly [TAction in keyof typeof handlers]: readonly string[] };

const actions = definePlatformActionContract(handlers, parameters, {
    unsupported: action =>
        new TwitchError(`未实现 Twitch 平台动作: ${action}`, {
            code: "TWITCH_ACTION_NOT_IMPLEMENTED",
        }),
    unexpectedParameter: (action, parameter) =>
        TwitchError.invalid(`Twitch 动作 ${action} 不接受参数 ${parameter}`),
});

export const TWITCH_PLATFORM_ACTIONS = actions.actions;
export type TwitchPlatformAction =
    typeof TWITCH_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

export function executeTwitchPlatformAction(
    client: TwitchClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return actions.execute(client, action, params);
}

function moderationQuery(params: Readonly<Record<string, unknown>>): Record<string, string> {
    return {
        broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id"),
        moderator_id: requireId(params.moderator_id, "moderator_id"),
    };
}

function resourceGet(path: string): PlatformActionHandler<TwitchClient> {
    return (client, params) => client.call("GET", path, { query: parseQuery(params.query) });
}

function resourceCreate(path: string, field: string): PlatformActionHandler<TwitchClient> {
    return (client, params) =>
        client.call("POST", path, {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
            body: requireObject(params[field], field),
        });
}

function resourcePatch(path: string, field: string): PlatformActionHandler<TwitchClient> {
    return (client, params) =>
        client.call("PATCH", path, {
            query: { broadcaster_id: requireId(params.broadcaster_id, "broadcaster_id") },
            body: requireObject(params[field], field),
        });
}

function enumValue<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
    if (typeof value === "string" && choices.includes(value as T)) return value as T;
    throw TwitchError.invalid(`${field} 必须是 ${choices.join("、")}`);
}

function announcementColor(
    value: unknown,
): "blue" | "green" | "orange" | "purple" | "primary" | undefined {
    return value === undefined
        ? undefined
        : enumValue(value, "color", ["blue", "green", "orange", "purple", "primary"] as const);
}

function conditionParams(value: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value))
        result[key] = requireString(item, `condition.${key}`, 512);
    return result;
}
