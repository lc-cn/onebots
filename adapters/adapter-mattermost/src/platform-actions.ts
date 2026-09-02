import { definePlatformActionContract, type PlatformActionHandler } from "onebots";
import {
    optionalBoolean,
    optionalInteger,
    optionalObject,
    optionalString,
    parseQuery,
    requireMethod,
    requireObject,
    requireString,
    requireStringArray,
} from "./action-params.js";
import type { MattermostClient } from "./client.js";
import { MattermostError } from "./errors.js";

const handlers = {
    call_mattermost_api: (client, params) =>
        client.call(requireMethod(params.method), requireString(params.path, "path"), {
            query: parseQuery(params.query),
            body: params.body,
        }),
    create_mattermost_post: (client, params) =>
        client.createPost(
            {
                channel_id: requireString(params.channel_id, "channel_id"),
                message: requireString(params.message, "message"),
                root_id: optionalString(params.root_id, "root_id"),
                file_ids:
                    params.file_ids === undefined
                        ? undefined
                        : requireStringArray(params.file_ids, "file_ids"),
                props: optionalObject(params.props, "props"),
                metadata: optionalObject(params.metadata, "metadata"),
            },
            optionalBoolean(params.silent, "silent") || false,
        ),
    create_mattermost_ephemeral_post: (client, params) =>
        client.call("POST", "posts/ephemeral", {
            body: {
                user_id: requireString(params.user_id, "user_id"),
                post: {
                    channel_id: requireString(params.channel_id, "channel_id"),
                    message: requireString(params.message, "message"),
                    props: optionalObject(params.props, "props"),
                },
            },
        }),
    search_mattermost_posts: (client, params) =>
        client.call("POST", "posts/search", {
            body: {
                terms: requireString(params.terms, "terms"),
                is_or_search: optionalBoolean(params.is_or_search, "is_or_search") || false,
                include_deleted_channels: optionalBoolean(
                    params.include_deleted_channels,
                    "include_deleted_channels",
                ),
                page: optionalInteger(params.page, "page"),
                per_page: optionalInteger(params.per_page, "per_page", 1, 200),
            },
        }),
    create_mattermost_scheduled_post: (client, params) =>
        client.call("POST", "posts/scheduled", { body: requireObject(params.post, "post") }),
    update_mattermost_scheduled_post: (client, params) =>
        client.call("PUT", `posts/scheduled/${id(params.scheduled_post_id, "scheduled_post_id")}`, {
            body: requireObject(params.post, "post"),
        }),
    delete_mattermost_scheduled_post: (client, params) =>
        client.call(
            "DELETE",
            `posts/scheduled/${id(params.scheduled_post_id, "scheduled_post_id")}`,
        ),
    list_mattermost_scheduled_posts: (client, params) =>
        client.call("GET", `posts/scheduled/team/${id(params.team_id, "team_id")}`, {
            query: {
                include_direct_channels: optionalBoolean(
                    params.include_direct_channels,
                    "include_direct_channels",
                ),
            },
        }),
    create_mattermost_direct_channel: (client, params) =>
        client.createDirectChannel(requireString(params.user_id, "user_id")),
    create_mattermost_group_channel: (client, params) =>
        client.createGroupChannel(requireStringArray(params.user_ids, "user_ids")),
    create_mattermost_channel: (client, params) =>
        client.createChannel({
            team_id: requireString(params.team_id, "team_id"),
            name: requireString(params.name, "name"),
            display_name: requireString(params.display_name, "display_name"),
            type: channelType(params.type),
            purpose: optionalString(params.purpose, "purpose"),
            header: optionalString(params.header, "header"),
        }),
    patch_mattermost_channel: (client, params) =>
        client.patchChannel(
            requireString(params.channel_id, "channel_id"),
            requireObject(params.patch, "patch"),
        ),
    archive_mattermost_channel: (client, params) =>
        client.archiveChannel(requireString(params.channel_id, "channel_id")),
    restore_mattermost_channel: (client, params) =>
        client.restoreChannel(requireString(params.channel_id, "channel_id")),
    add_mattermost_channel_member: (client, params) =>
        client.addChannelMember(
            requireString(params.channel_id, "channel_id"),
            requireString(params.user_id, "user_id"),
        ),
    remove_mattermost_channel_member: (client, params) =>
        client.removeChannelMember(
            requireString(params.channel_id, "channel_id"),
            requireString(params.user_id, "user_id"),
        ),
    create_mattermost_team: (client, params) =>
        client.call("POST", "teams", { body: requireObject(params.team, "team") }),
    patch_mattermost_team: (client, params) =>
        client.call("PUT", `teams/${id(params.team_id, "team_id")}/patch`, {
            body: requireObject(params.patch, "patch"),
        }),
    archive_mattermost_team: (client, params) =>
        client.call("DELETE", `teams/${id(params.team_id, "team_id")}`),
    restore_mattermost_team: (client, params) =>
        client.call("POST", `teams/${id(params.team_id, "team_id")}/restore`),
    add_mattermost_team_member: (client, params) =>
        client.call("POST", `teams/${id(params.team_id, "team_id")}/members`, {
            body: {
                team_id: requireString(params.team_id, "team_id"),
                user_id: requireString(params.user_id, "user_id"),
            },
        }),
    remove_mattermost_team_member: (client, params) =>
        client.call(
            "DELETE",
            `teams/${id(params.team_id, "team_id")}/members/${id(params.user_id, "user_id")}`,
        ),
    set_mattermost_status: (client, params) => client.setStatus(status(params.status)),
    send_mattermost_typing: (client, params) =>
        client.sendWebSocketAction("user_typing", {
            channel_id: requireString(params.channel_id, "channel_id"),
            parent_id: optionalString(params.root_id, "root_id") || "",
        }),
    get_mattermost_statuses: client => client.sendWebSocketAction("get_statuses"),
    get_mattermost_statuses_by_ids: (client, params) =>
        client.sendWebSocketAction("get_statuses_by_ids", {
            user_ids: requireStringArray(params.user_ids, "user_ids"),
        }),
    list_mattermost_emoji: (client, params) =>
        client.call("GET", "emoji", {
            query: {
                page: optionalInteger(params.page, "page") || 0,
                per_page: optionalInteger(params.per_page, "per_page", 1, 200) || 60,
                sort: optionalString(params.sort, "sort"),
            },
        }),
    get_mattermost_emoji_by_name: (client, params) =>
        client.call("GET", `emoji/name/${encodeURIComponent(requireString(params.name, "name"))}`),
    list_mattermost_bots: (client, params) =>
        client.call("GET", "bots", {
            query: {
                page: optionalInteger(params.page, "page") || 0,
                per_page: optionalInteger(params.per_page, "per_page", 1, 200) || 60,
                include_deleted: optionalBoolean(params.include_deleted, "include_deleted"),
                only_orphaned: optionalBoolean(params.only_orphaned, "only_orphaned"),
            },
        }),
    create_mattermost_bot: (client, params) =>
        client.call("POST", "bots", { body: requireObject(params.bot, "bot") }),
    patch_mattermost_bot: (client, params) =>
        client.call("PUT", `bots/${id(params.bot_user_id, "bot_user_id")}`, {
            body: requireObject(params.patch, "patch"),
        }),
    enable_mattermost_bot: (client, params) =>
        client.call("POST", `bots/${id(params.bot_user_id, "bot_user_id")}/enable`),
    disable_mattermost_bot: (client, params) =>
        client.call("POST", `bots/${id(params.bot_user_id, "bot_user_id")}/disable`),
    execute_mattermost_command: (client, params) =>
        client.call("POST", "commands/execute", {
            body: {
                channel_id: requireString(params.channel_id, "channel_id"),
                command: requireString(params.command, "command"),
                team_id: optionalString(params.team_id, "team_id"),
            },
        }),
    list_mattermost_channel_bookmarks: (client, params) =>
        client.call("GET", `channels/${id(params.channel_id, "channel_id")}/bookmarks`, {
            query: {
                bookmarks_since: optionalInteger(params.bookmarks_since, "bookmarks_since"),
            },
        }),
    create_mattermost_channel_bookmark: (client, params) =>
        client.call("POST", `channels/${id(params.channel_id, "channel_id")}/bookmarks`, {
            body: requireObject(params.bookmark, "bookmark"),
        }),
    update_mattermost_channel_bookmark: (client, params) =>
        client.call(
            "PATCH",
            `channels/${id(params.channel_id, "channel_id")}/bookmarks/${id(params.bookmark_id, "bookmark_id")}`,
            { body: requireObject(params.patch, "patch") },
        ),
    delete_mattermost_channel_bookmark: (client, params) =>
        client.call(
            "DELETE",
            `channels/${id(params.channel_id, "channel_id")}/bookmarks/${id(params.bookmark_id, "bookmark_id")}`,
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<MattermostClient>>>;

const parameters = {
    call_mattermost_api: ["method", "path", "query", "body"],
    create_mattermost_post: [
        "channel_id",
        "message",
        "root_id",
        "file_ids",
        "props",
        "metadata",
        "silent",
    ],
    create_mattermost_ephemeral_post: ["user_id", "channel_id", "message", "props"],
    search_mattermost_posts: [
        "terms",
        "is_or_search",
        "include_deleted_channels",
        "page",
        "per_page",
    ],
    create_mattermost_scheduled_post: ["post"],
    update_mattermost_scheduled_post: ["scheduled_post_id", "post"],
    delete_mattermost_scheduled_post: ["scheduled_post_id"],
    list_mattermost_scheduled_posts: ["team_id", "include_direct_channels"],
    create_mattermost_direct_channel: ["user_id"],
    create_mattermost_group_channel: ["user_ids"],
    create_mattermost_channel: ["team_id", "name", "display_name", "type", "purpose", "header"],
    patch_mattermost_channel: ["channel_id", "patch"],
    archive_mattermost_channel: ["channel_id"],
    restore_mattermost_channel: ["channel_id"],
    add_mattermost_channel_member: ["channel_id", "user_id"],
    remove_mattermost_channel_member: ["channel_id", "user_id"],
    create_mattermost_team: ["team"],
    patch_mattermost_team: ["team_id", "patch"],
    archive_mattermost_team: ["team_id"],
    restore_mattermost_team: ["team_id"],
    add_mattermost_team_member: ["team_id", "user_id"],
    remove_mattermost_team_member: ["team_id", "user_id"],
    set_mattermost_status: ["status"],
    send_mattermost_typing: ["channel_id", "root_id"],
    get_mattermost_statuses: [],
    get_mattermost_statuses_by_ids: ["user_ids"],
    list_mattermost_emoji: ["page", "per_page", "sort"],
    get_mattermost_emoji_by_name: ["name"],
    list_mattermost_bots: ["page", "per_page", "include_deleted", "only_orphaned"],
    create_mattermost_bot: ["bot"],
    patch_mattermost_bot: ["bot_user_id", "patch"],
    enable_mattermost_bot: ["bot_user_id"],
    disable_mattermost_bot: ["bot_user_id"],
    execute_mattermost_command: ["channel_id", "command", "team_id"],
    list_mattermost_channel_bookmarks: ["channel_id", "bookmarks_since"],
    create_mattermost_channel_bookmark: ["channel_id", "bookmark"],
    update_mattermost_channel_bookmark: ["channel_id", "bookmark_id", "patch"],
    delete_mattermost_channel_bookmark: ["channel_id", "bookmark_id"],
} satisfies { readonly [TAction in keyof typeof handlers]: readonly string[] };

const actions = definePlatformActionContract(handlers, parameters, {
    unsupported: action =>
        new MattermostError(`未实现 Mattermost 平台动作: ${action}`, {
            code: "MATTERMOST_ACTION_NOT_IMPLEMENTED",
        }),
    unexpectedParameter: (action, parameter) =>
        MattermostError.invalid(`Mattermost 动作 ${action} 不接受参数 ${parameter}`),
});

export const MATTERMOST_PLATFORM_ACTIONS = actions.actions;
export type MattermostPlatformAction =
    typeof MATTERMOST_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

export function executeMattermostPlatformAction(
    client: MattermostClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return actions.execute(client, action, params);
}

function id(value: unknown, field: string): string {
    const text = requireString(value, field);
    if (!/^[a-z0-9]+$/u.test(text)) throw MattermostError.invalid(`${field} 无效`);
    return encodeURIComponent(text);
}

function channelType(value: unknown): "O" | "P" {
    if (value === undefined || value === "O") return "O";
    if (value === "P") return "P";
    throw MattermostError.invalid("type 必须是 O（公开）或 P（私有）");
}

function status(value: unknown): "online" | "away" | "dnd" | "offline" {
    if (["online", "away", "dnd", "offline"].includes(String(value))) {
        return value as "online" | "away" | "dnd" | "offline";
    }
    throw MattermostError.invalid("status 必须是 online、away、dnd 或 offline");
}
