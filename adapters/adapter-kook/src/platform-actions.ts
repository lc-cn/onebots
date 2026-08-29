import { definePlatformActions, materializeMediaSource, type PlatformActionHandler } from "onebots";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";
import type { KookApiRequestOptions } from "./types.js";

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
    list_invitees: { path: "/v3/invite/invitees", method: "GET" },
    list_channel_messages: { path: "/v3/message/list", method: "GET" },
    send_pipe_message: { path: "/v3/message/send-pipemsg", method: "POST" },
    list_direct_messages: { path: "/v3/direct-message/list", method: "GET" },
    list_user_chats: { path: "/v3/user-chat/list", method: "GET" },
    get_user_chat: { path: "/v3/user-chat/view", method: "GET" },
    create_user_chat: { path: "/v3/user-chat/create", method: "POST" },
    delete_user_chat: { path: "/v3/user-chat/delete", method: "POST" },
    list_guild_emojis: { path: "/v3/guild-emoji/list", method: "GET" },
    update_guild_emoji: { path: "/v3/guild-emoji/update", method: "POST" },
    delete_guild_emoji: { path: "/v3/guild-emoji/delete", method: "POST" },
    get_intimacy: { path: "/v3/intimacy/index", method: "GET" },
    update_intimacy: { path: "/v3/intimacy/update", method: "POST" },
    list_games: { path: "/v3/game", method: "GET" },
    create_game: { path: "/v3/game/create", method: "POST" },
    update_game: { path: "/v3/game/update", method: "POST" },
    delete_game: { path: "/v3/game/delete", method: "POST" },
    set_game_activity: { path: "/v3/game/activity", method: "POST" },
    delete_game_activity: { path: "/v3/game/delete-activity", method: "POST" },
    list_message_templates: { path: "/v3/template/list", method: "GET" },
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

const ROUTE_HANDLERS = Object.fromEntries(
    Object.entries(ROUTES).map(([action, route]) => [
        action,
        (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
            bot.callApi(
                route.path,
                route.method === "GET"
                    ? { query: scalarParams(params) }
                    : { method: "POST", body: { ...params } },
            ),
    ]),
) satisfies Readonly<Record<string, PlatformActionHandler<KookBot>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    {
        call_kook_api: (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
            bot.callApi(requirePath(params.path), {
                method: methodValue(params.method),
                query: queryValue(params.query),
                body: bodyValue(params.body),
            }),
        upload_asset: async (bot: KookBot, params: Readonly<Record<string, unknown>>) => {
            const media = await mediaFromParams(params);
            return { url: await bot.uploadAsset(media.data, media.filename, media.contentType) };
        },
        create_guild_emoji: createGuildEmoji,
        get_guild_badge: getGuildBadge,
        ...ROUTE_HANDLERS,
    },
    action =>
        KookError.invalid(`未实现 KOOK 平台动作: ${action}`, "KOOK_ACTION_UNKNOWN", {
            action,
        }),
);

export const KOOK_PLATFORM_ACTIONS: ReadonlySet<string> = PLATFORM_ACTIONS.actions;

/** 执行 KOOK 官方扩展动作；命名参数直接沿用开放平台字段。 */
export async function executeKookPlatformAction(
    bot: KookBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
}

async function createGuildEmoji(
    bot: KookBot,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const guildId = requiredString(params.guild_id, "guild_id");
    const media = await mediaFromParams(params, "emoji");
    if (media.contentType !== "image/png" || media.data.byteLength > 256 * 1_024) {
        throw KookError.invalid(
            "KOOK 服务器表情必须是小于等于 256 KiB 的 PNG",
            "KOOK_GUILD_EMOJI_INVALID",
            { content_type: media.contentType, size: media.data.byteLength },
        );
    }
    return bot.callMultipart(
        "/v3/guild-emoji/create",
        { guild_id: guildId, name: optionalString(params.name) },
        {
            field: "emoji",
            data: media.data,
            filename: media.filename,
            contentType: media.contentType,
        },
    );
}

async function getGuildBadge(
    bot: KookBot,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const result = await bot.download("/v3/badge/guild", {
        guild_id: requiredString(params.guild_id, "guild_id"),
        style: scalarValue(params.style, "style"),
    });
    return {
        content_type: result.contentType,
        data: `base64://${Buffer.from(result.data).toString("base64")}`,
    };
}

async function mediaFromParams(params: Readonly<Record<string, unknown>>, preferredKey = "file") {
    const source =
        optionalString(params[preferredKey]) ||
        optionalString(params.file) ||
        optionalString(params.url) ||
        optionalString(params.src);
    if (!source) {
        throw KookError.invalid(
            `KOOK 参数 ${preferredKey} 必须提供媒体来源`,
            "KOOK_ACTION_MEDIA_REQUIRED",
        );
    }
    return materializeMediaSource({
        source,
        filename: optionalString(params.filename) || optionalString(params.name),
        contentType: optionalString(params.content_type) || optionalString(params.mime),
    });
}

function requiredString(value: unknown, key: string): string {
    const result = optionalString(value);
    if (result) return result;
    throw KookError.invalid(`KOOK 参数 ${key} 不能为空`, "KOOK_ACTION_PARAM_REQUIRED", {
        key,
    });
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function scalarValue(value: unknown, key: string): string | number | boolean | undefined {
    if (value == null) return undefined;
    if (["string", "number", "boolean"].includes(typeof value)) {
        return value as string | number | boolean;
    }
    throw KookError.invalid(`KOOK 参数 ${key} 必须为标量`, "KOOK_ACTION_PARAM_INVALID", {
        key,
        value,
    });
}

function requirePath(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("/v3/") || value.includes("..")) {
        throw KookError.invalid(
            "KOOK 参数 path 必须是 /v3/ 下的安全绝对路径",
            "KOOK_ACTION_PATH_INVALID",
            { value },
        );
    }
    return value;
}

function methodValue(value: unknown): KookApiRequestOptions["method"] {
    const method = typeof value === "string" ? value.toUpperCase() : "GET";
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
        throw KookError.invalid(
            "KOOK 参数 method 不是受支持的 HTTP 方法",
            "KOOK_ACTION_METHOD_INVALID",
            { method },
        );
    }
    return method as KookApiRequestOptions["method"];
}

function bodyValue(value: unknown): Record<string, unknown> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw KookError.invalid("KOOK 参数 body 必须为对象", "KOOK_ACTION_BODY_INVALID");
    }
    return value as Record<string, unknown>;
}

function queryValue(
    value: unknown,
): Record<string, string | number | boolean | undefined> | undefined {
    if (value == null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw KookError.invalid("KOOK 参数 query 必须为对象", "KOOK_ACTION_QUERY_INVALID");
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
        } else {
            throw KookError.invalid(
                `KOOK query 参数 ${key} 必须为标量`,
                "KOOK_ACTION_QUERY_VALUE_INVALID",
                { key, value },
            );
        }
    }
    return result;
}
