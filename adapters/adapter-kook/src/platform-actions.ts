import type { KookBot } from "./bot.js";
import type { KookApiRequestOptions } from "./types.js";

export const KOOK_PLATFORM_ACTIONS = new Set([
    "call_kook_api",
    "get_message_reactions",
    "add_message_reaction",
    "remove_message_reaction",
    "get_direct_message_reactions",
    "add_direct_message_reaction",
    "remove_direct_message_reaction",
    "pin_message",
    "unpin_message",
    "list_guild_roles",
    "create_guild_role",
    "update_guild_role",
    "delete_guild_role",
    "grant_guild_role",
    "revoke_guild_role",
    "get_channel_permissions",
    "create_channel_permission",
    "update_channel_permission",
    "sync_channel_permissions",
    "delete_channel_permission",
    "list_blacklist",
    "add_blacklist",
    "remove_blacklist",
    "list_guild_mutes",
    "add_guild_mute",
    "remove_guild_mute",
    "get_guild_boost_history",
    "list_invites",
    "create_invite",
    "delete_invite",
    "list_thread_categories",
    "create_thread",
    "reply_thread",
    "get_thread",
    "list_threads",
    "delete_thread_item",
    "list_thread_posts",
    "move_voice_user",
    "kick_voice_user",
    "get_joined_voice_channel",
    "set_bot_online",
    "set_bot_offline",
    "get_bot_online_status",
    "leave_guild",
    "kick_guild_member",
    "set_guild_member_nickname",
]);

interface ActionRoute {
    path: string;
    method: "GET" | "POST";
}

const ROUTES: Readonly<Record<string, ActionRoute>> = {
    get_message_reactions: { path: "/v3/message/reaction-list", method: "GET" },
    add_message_reaction: { path: "/v3/message/add-reaction", method: "POST" },
    remove_message_reaction: { path: "/v3/message/delete-reaction", method: "POST" },
    get_direct_message_reactions: { path: "/v3/direct-message/reaction-list", method: "GET" },
    add_direct_message_reaction: { path: "/v3/direct-message/add-reaction", method: "POST" },
    remove_direct_message_reaction: { path: "/v3/direct-message/delete-reaction", method: "POST" },
    pin_message: { path: "/v3/message/pin", method: "POST" },
    unpin_message: { path: "/v3/message/unpin", method: "POST" },
    list_guild_roles: { path: "/v3/guild-role/list", method: "GET" },
    create_guild_role: { path: "/v3/guild-role/create", method: "POST" },
    update_guild_role: { path: "/v3/guild-role/update", method: "POST" },
    delete_guild_role: { path: "/v3/guild-role/delete", method: "POST" },
    grant_guild_role: { path: "/v3/guild-role/grant", method: "POST" },
    revoke_guild_role: { path: "/v3/guild-role/revoke", method: "POST" },
    get_channel_permissions: { path: "/v3/channel-role/index", method: "GET" },
    create_channel_permission: { path: "/v3/channel-role/create", method: "POST" },
    update_channel_permission: { path: "/v3/channel-role/update", method: "POST" },
    sync_channel_permissions: { path: "/v3/channel-role/sync", method: "POST" },
    delete_channel_permission: { path: "/v3/channel-role/delete", method: "POST" },
    list_blacklist: { path: "/v3/blacklist/list", method: "GET" },
    add_blacklist: { path: "/v3/blacklist/create", method: "POST" },
    remove_blacklist: { path: "/v3/blacklist/delete", method: "POST" },
    list_guild_mutes: { path: "/v3/guild-mute/list", method: "GET" },
    add_guild_mute: { path: "/v3/guild-mute/create", method: "POST" },
    remove_guild_mute: { path: "/v3/guild-mute/delete", method: "POST" },
    get_guild_boost_history: { path: "/v3/guild-boost/history", method: "GET" },
    list_invites: { path: "/v3/invite/list", method: "GET" },
    create_invite: { path: "/v3/invite/create", method: "POST" },
    delete_invite: { path: "/v3/invite/delete", method: "POST" },
    list_thread_categories: { path: "/v3/category/list", method: "GET" },
    create_thread: { path: "/v3/thread/create", method: "POST" },
    reply_thread: { path: "/v3/thread/reply", method: "POST" },
    get_thread: { path: "/v3/thread/view", method: "GET" },
    list_threads: { path: "/v3/thread/list", method: "GET" },
    delete_thread_item: { path: "/v3/thread/delete", method: "POST" },
    list_thread_posts: { path: "/v3/thread/post", method: "GET" },
    move_voice_user: { path: "/v3/channel/move-user", method: "POST" },
    kick_voice_user: { path: "/v3/channel/kickout", method: "POST" },
    get_joined_voice_channel: { path: "/v3/channel-user/get-joined-channel", method: "GET" },
    set_bot_online: { path: "/v3/user/online", method: "POST" },
    set_bot_offline: { path: "/v3/user/offline", method: "POST" },
    get_bot_online_status: { path: "/v3/user/get-online-status", method: "GET" },
    leave_guild: { path: "/v3/guild/leave", method: "POST" },
    kick_guild_member: { path: "/v3/guild/kickout", method: "POST" },
    set_guild_member_nickname: { path: "/v3/guild/nickname", method: "POST" },
};

/** 执行 KOOK 官方扩展动作；命名参数直接沿用开放平台字段。 */
export function executeKookPlatformAction(
    bot: KookBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    if (action === "call_kook_api") {
        return bot.callApi(requirePath(params.path), {
            method: methodValue(params.method),
            query: queryValue(params.query),
            body: bodyValue(params.body),
        });
    }
    const route = ROUTES[action];
    if (!route) throw new Error(`未实现 KOOK 平台动作: ${action}`);
    return bot.callApi(
        route.path,
        route.method === "GET"
            ? { query: scalarParams(params) }
            : {
                  method: "POST",
                  body: { ...params },
              },
    );
}

function requirePath(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("/v3/") || value.includes("..")) {
        throw new Error("KOOK 参数 path 必须是 /v3/ 下的安全绝对路径");
    }
    return value;
}

function methodValue(value: unknown): KookApiRequestOptions["method"] {
    const method = typeof value === "string" ? value.toUpperCase() : "GET";
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
        throw new Error("KOOK 参数 method 不是受支持的 HTTP 方法");
    }
    return method as KookApiRequestOptions["method"];
}

function bodyValue(value: unknown): Record<string, unknown> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("KOOK 参数 body 必须为对象");
    }
    return value as Record<string, unknown>;
}

function queryValue(
    value: unknown,
): Record<string, string | number | boolean | undefined> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("KOOK 参数 query 必须为对象");
    }
    return scalarParams(value as Readonly<Record<string, unknown>>);
}

function scalarParams(
    params: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | undefined> {
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value == null) result[key] = undefined;
        else if (["string", "number", "boolean"].includes(typeof value)) {
            result[key] = value as string | number | boolean;
        } else throw new Error(`KOOK query 参数 ${key} 必须为标量`);
    }
    return result;
}
