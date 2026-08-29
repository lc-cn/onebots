import type { QQClient } from "./client.js";
import type { QQActionHandler, QQActionParams } from "./platform-action-context.js";
import {
    optionalNumber,
    optionalQuery,
    reactionPath,
    requiredRecord,
    requiredString,
    schedulePath,
    threadPath,
} from "./platform-action-params.js";

/** 频道公告、置顶、表态、日程、帖子与语音动作。 */
export const QQ_CHANNEL_ACTIONS = {
    set_channel_announce: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `/guilds/${requiredString(params, "guild_id")}/announces`,
            body: {
                channel_id: requiredString(params, "channel_id"),
                message_id: requiredString(params, "message_id"),
            },
        }),
    get_channel_pins: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: `/channels/${requiredString(params, "channel_id")}/pins`,
        }),
    pin_channel_message: pinAction("PUT"),
    unpin_channel_message: pinAction("DELETE"),
    add_reaction: reactionAction("PUT"),
    remove_reaction: reactionAction("DELETE"),
    get_reaction_members: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: reactionPath(params),
            query: optionalQuery(params.query),
        }),
    get_schedules: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: `/channels/${requiredString(params, "channel_id")}/schedules`,
            query: optionalQuery(params.query),
        }),
    get_schedule: scheduleAction("GET"),
    create_schedule: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `/channels/${requiredString(params, "channel_id")}/schedules`,
            body: { schedule: requiredRecord(params, "schedule") },
        }),
    update_schedule: scheduleAction("PATCH"),
    delete_schedule: scheduleAction("DELETE"),
    get_channel_threads: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: `/channels/${requiredString(params, "channel_id")}/threads`,
        }),
    get_channel_thread: threadAction("GET"),
    publish_thread: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `/channels/${requiredString(params, "channel_id")}/threads`,
            body: {
                title: requiredString(params, "title"),
                content: requiredString(params, "content"),
                format: optionalNumber(params.format) ?? 1,
            },
        }),
    delete_thread: threadAction("DELETE"),
    control_channel_audio: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `/channels/${requiredString(params, "channel_id")}/audio`,
            body: requiredRecord(params, "control"),
        }),
    put_channel_microphone: microphoneAction("PUT"),
    delete_channel_microphone: microphoneAction("DELETE"),
} satisfies Readonly<Record<string, QQActionHandler>>;

function pinAction(method: "PUT" | "DELETE"): QQActionHandler {
    return async (client, params) =>
        client.call({
            method,
            path: `/channels/${requiredString(params, "channel_id")}/pins/${requiredString(params, "message_id")}`,
        });
}

function reactionAction(method: "PUT" | "DELETE"): QQActionHandler {
    return async (client, params) => client.call({ method, path: reactionPath(params) });
}

function scheduleAction(method: "GET" | "PATCH" | "DELETE"): QQActionHandler {
    return async (client, params) => {
        const path = schedulePath(params);
        return method === "PATCH"
            ? client.call({
                  method,
                  path,
                  body: { schedule: requiredRecord(params, "schedule") },
              })
            : client.call({ method, path });
    };
}

function threadAction(method: "GET" | "DELETE"): QQActionHandler {
    return async (client, params) => client.call({ method, path: threadPath(params) });
}

function microphoneAction(method: "PUT" | "DELETE"): QQActionHandler {
    return async (client, params) =>
        client.call({
            method,
            path: `/channels/${requiredString(params, "channel_id")}/mic`,
        });
}
