import {
    definePlatformActionHandlers,
    definePlatformActions,
    isSafeAbsoluteApiPath,
    materializeMediaSource,
    type PlatformActionHandler,
} from "onebots";
import type { KookBot } from "./bot.js";
import { KookError } from "./errors.js";
import type { KookApiRequestOptions, KookOAuthScope } from "./types.js";
import { KOOK_FRIEND_PLATFORM_ACTIONS } from "./platform-actions-friend.js";
import { KOOK_GUILD_PLATFORM_ACTIONS } from "./platform-actions-guild.js";
import { KOOK_MESSAGE_PLATFORM_ACTIONS } from "./platform-actions-message.js";
import { KOOK_PERMISSION_PLATFORM_ACTIONS } from "./platform-actions-permission.js";

interface ActionRoute {
    path: string;
    method: "GET" | "POST";
}

const ROUTES: Readonly<Record<string, ActionRoute>> = {
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
    create_message_template: { path: "/v3/template/create", method: "POST" },
    update_message_template: { path: "/v3/template/update", method: "POST" },
    delete_message_template: { path: "/v3/template/delete", method: "POST" },
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
    join_voice_channel: { path: "/v3/voice/join", method: "POST" },
    list_joined_voice_channels: { path: "/v3/voice/list", method: "GET" },
    leave_voice_channel: { path: "/v3/voice/leave", method: "POST" },
    keep_voice_channel_alive: { path: "/v3/voice/keep-alive", method: "POST" },
    set_bot_online: { path: "/v3/user/online", method: "POST" },
    set_bot_offline: { path: "/v3/user/offline", method: "POST" },
    get_bot_online_status: { path: "/v3/user/get-online-status", method: "GET" },
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

const SPECIAL_ACTION_HANDLERS = {
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
    create_oauth_authorization_url: (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
        Promise.resolve({
            url: bot.buildOAuthAuthorizationUrl(
                oauthScopes(params.scope),
                requiredString(params.state, "state"),
            ),
        }),
    exchange_oauth_code: (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
        bot.exchangeOAuthCode(requiredString(params.code, "code")),
    get_oauth_user_info: (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
        bot.getOAuthUserInfo(requiredString(params.access_token, "access_token")),
    list_oauth_user_guilds: (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
        bot.listOAuthUserGuilds(
            requiredString(params.access_token, "access_token"),
            oauthGuildListQuery(params),
        ),
    call_kook_oauth_api: (bot: KookBot, params: Readonly<Record<string, unknown>>) =>
        bot.callOAuthApi(
            requiredString(params.access_token, "access_token"),
            requirePath(params.path),
            queryValue(params.query),
        ),
    create_guild_emoji: createGuildEmoji,
    get_guild_badge: getGuildBadge,
} satisfies Readonly<Record<string, PlatformActionHandler<KookBot>>>;

const SPECIAL_ACTIONS = definePlatformActionHandlers(
    SPECIAL_ACTION_HANDLERS,
    {
        call_kook_api: ["path", "method", "query", "body"],
        upload_asset: ["file", "url", "src", "filename", "name", "content_type", "mime"],
        create_oauth_authorization_url: ["scope", "state"],
        exchange_oauth_code: ["code"],
        get_oauth_user_info: ["access_token"],
        list_oauth_user_guilds: ["access_token", "page", "page_size", "sort"],
        call_kook_oauth_api: ["access_token", "path", "query"],
        create_guild_emoji: [
            "guild_id",
            "emoji",
            "file",
            "url",
            "src",
            "filename",
            "name",
            "content_type",
            "mime",
        ],
        get_guild_badge: ["guild_id", "style"],
    },
    (action, parameter) =>
        KookError.invalid(
            `KOOK 动作 ${action} 不接受参数 ${parameter}`,
            "KOOK_ACTION_PARAM_UNKNOWN",
            { action, key: parameter },
        ),
);

const PLATFORM_ACTIONS = definePlatformActions(
    {
        ...SPECIAL_ACTIONS,
        ...KOOK_FRIEND_PLATFORM_ACTIONS,
        ...KOOK_GUILD_PLATFORM_ACTIONS,
        ...KOOK_MESSAGE_PLATFORM_ACTIONS,
        ...KOOK_PERMISSION_PLATFORM_ACTIONS,
        ...ROUTE_HANDLERS,
    },
    action =>
        KookError.invalid(`未实现 KOOK 平台动作: ${action}`, "KOOK_ACTION_UNKNOWN", {
            action,
        }),
);

export const KOOK_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type KookPlatformAction =
    typeof KOOK_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行 KOOK 官方扩展动作；命名参数由对应的开放平台契约约束。 */
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

function oauthScopes(value: unknown): KookOAuthScope[] {
    const values = typeof value === "string" ? value.split(/\s+/u) : value;
    if (!Array.isArray(values) || values.length === 0) {
        throw KookError.invalid(
            "KOOK OAuth scope 必须是非空字符串或字符串数组",
            "KOOK_OAUTH_SCOPE_INVALID",
        );
    }
    const allowed = new Set<KookOAuthScope>(["get_user_info", "get_user_guilds"]);
    if (values.some(scope => typeof scope !== "string" || !allowed.has(scope as KookOAuthScope))) {
        throw KookError.invalid(
            "KOOK OAuth scope 仅支持 get_user_info、get_user_guilds",
            "KOOK_OAUTH_SCOPE_INVALID",
            { scope: values },
        );
    }
    return values as KookOAuthScope[];
}

function oauthGuildListQuery(
    params: Readonly<Record<string, unknown>>,
): Record<string, string | number | undefined> {
    return {
        page: optionalPositiveInteger(params.page, "page"),
        page_size: optionalPositiveInteger(params.page_size, "page_size", 50),
        sort: optionalString(params.sort),
    };
}

function optionalPositiveInteger(value: unknown, key: string, max?: number): number | undefined {
    if (value === undefined) return undefined;
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        (max !== undefined && value > max)
    ) {
        throw KookError.invalid(
            `KOOK 参数 ${key} 必须是 1${max ? ` 到 ${max}` : " 以上"}的整数`,
            "KOOK_ACTION_PARAM_INVALID",
            { key, value },
        );
    }
    return value;
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
    if (typeof value !== "string" || !value.startsWith("/v3/") || !isSafeAbsoluteApiPath(value)) {
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
