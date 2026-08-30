import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { HeychatBot } from "./bot.js";
import { isSafeHeychatApiPath } from "./api-path.js";
import { HeychatApiError } from "./errors.js";
import { normalizeBase64Source, uploadHeychatMedia } from "./media.js";
import type { HeychatApiRequestOptions, HeychatVoiceDurationQuery } from "./types.js";

interface ActionRoute {
    path: string;
    method: "GET" | "POST";
}

const ROUTES: Readonly<Record<string, ActionRoute>> = {
    send_channel_message: { path: "/chatroom/v2/channel_msg/send", method: "POST" },
    send_private_message: { path: "/chatroom/v3/msg/user", method: "POST" },
    update_channel_message: { path: "/chatroom/v2/channel_msg/update", method: "POST" },
    delete_channel_message: { path: "/chatroom/v2/channel_msg/delete", method: "POST" },
    set_message_reaction: { path: "/chatroom/v2/channel_msg/emoji/reply", method: "POST" },
    list_room_roles: { path: "/chatroom/v2/room_role/roles", method: "GET" },
    create_room_role: { path: "/chatroom/v2/room_role/create", method: "POST" },
    update_room_role: { path: "/chatroom/v2/room_role/update", method: "POST" },
    delete_room_role: { path: "/chatroom/v2/room_role/delete", method: "POST" },
    grant_room_role: { path: "/chatroom/v2/room_role/grant", method: "POST" },
    revoke_room_role: { path: "/chatroom/v2/room_role/revoke", method: "POST" },
    list_room_memes: { path: "/chatroom/v3/msg/meme/room/list", method: "GET" },
    delete_room_meme: { path: "/chatroom/v2/msg/meme/room/del", method: "POST" },
    update_room_meme: { path: "/chatroom/v2/msg/meme/room/edit", method: "POST" },
    set_room_nickname: { path: "/chatroom/v2/room/nickname", method: "POST" },
    list_joined_rooms: { path: "/chatroom/v2/room/joined", method: "GET" },
    get_room: { path: "/chatroom/v2/room/view", method: "GET" },
    leave_room: { path: "/chatroom/v2/room/leave", method: "POST" },
    kick_room_member: { path: "/chatroom/v2/room/kick_out", method: "POST" },
    move_voice_member: { path: "/chatroom/v2/channel/move_member", method: "POST" },
    kick_voice_member: { path: "/chatroom/v2/channel/kick_out", method: "POST" },
    set_room_ban: { path: "/chatroom/v2/room/ban", method: "POST" },
    toggle_channel_microphone: { path: "/chatroom/v2/channel/mute_user", method: "POST" },
    toggle_room_microphone: { path: "/chatroom/v2/room/mute", method: "POST" },
    toggle_room_speaker: { path: "/chatroom/v2/room/mute_earphone", method: "POST" },
    get_user_voice_channel: { path: "/chatroom/v2/channel/which_user", method: "GET" },
    list_voice_channel_members: { path: "/chatroom/v2/channel/user/list", method: "GET" },
    create_channel_invite: { path: "/chatroom/v2/invite/code", method: "GET" },
    update_channel_settings: { path: "/chatroom/v2/settings/channel/edit", method: "POST" },
    rename_channel: { path: "/chatroom/v2/channel/edit", method: "POST" },
    set_channel_password: { path: "/chatroom/channel/edit_password/no_encrypt", method: "POST" },
    set_channel_permission: { path: "/chatroom/v2/role/role_user_perm", method: "POST" },
    list_room_users: { path: "/chatroom/v2/room/users", method: "GET" },
    get_channel_permissions: {
        path: "/chatroom/v2/channel_user_perm/list_with_parent",
        method: "GET",
    },
    start_voice_stream: { path: "/chatroom/v3/channel/stream/push", method: "POST" },
    stop_voice_stream: { path: "/chatroom/v3/channel/stream/stop", method: "POST" },
};

const ROUTE_HANDLERS = Object.fromEntries(
    Object.entries(ROUTES).map(([action, route]) => [
        action,
        (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
            bot.callApi(
                route.path,
                route.method === "GET"
                    ? { query: scalarParams(params) }
                    : { method: "POST", body: { ...params } },
            ),
    ]),
) satisfies Readonly<Record<string, PlatformActionHandler<HeychatBot>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    {
        call_heychat_api: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
            bot.callApi(requireApiPath(params.path), {
                method: methodValue(params.method),
                query: queryValue(params.query),
                body: objectValue(params.body, "body"),
            }),
        upload_media: async (bot: HeychatBot, params: Readonly<Record<string, unknown>>) => ({
            url: await uploadHeychatMedia(bot, {
                source: normalizeBase64Source(requiredString(params.data, "data")),
                filename: requiredString(params.filename, "filename"),
                contentType: optionalString(params.content_type, "content_type"),
            }),
        }),
        create_oauth_authorization_url: (
            bot: HeychatBot,
            params: Readonly<Record<string, unknown>>,
        ) => {
            assertAllowedParams(params, ["scope"]);
            return Promise.resolve({
                url: bot.buildOAuthAuthorizationUrl(scopeValue(params.scope)),
            });
        },
        exchange_oauth_code: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) => {
            assertAllowedParams(params, ["code"]);
            return bot.exchangeOAuthCode(requiredString(params.code, "code"));
        },
        refresh_oauth_token: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) => {
            assertAllowedParams(params, ["refresh_token"]);
            return bot.refreshOAuthToken(requiredString(params.refresh_token, "refresh_token"));
        },
        get_oauth_user_info: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) => {
            assertAllowedParams(params, ["access_token"]);
            return bot.getOAuthUserInfo(requiredString(params.access_token, "access_token"));
        },
        request_oauth_user_info: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) => {
            assertAllowedParams(params, ["user_id", "scope"]);
            return bot.requestOAuthUserInfo(
                requiredString(params.user_id, "user_id"),
                scopeValue(params.scope),
            );
        },
        get_oauth_voice_duration: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) => {
            assertAllowedParams(params, ["access_token", ...DURATION_PARAMS]);
            return bot.getOAuthVoiceDuration(
                requiredString(params.access_token, "access_token"),
                durationQuery(params),
            );
        },
        get_oauth_game_duration: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) => {
            assertAllowedParams(params, ["access_token", ...DURATION_PARAMS]);
            return bot.getOAuthVoiceDuration(requiredString(params.access_token, "access_token"), {
                ...durationQuery(params),
                appid: requiredString(params.appid, "appid"),
            });
        },
        ...ROUTE_HANDLERS,
    },
    action =>
        HeychatApiError.resource(`未实现黑盒语音平台动作: ${action}`, "HEYCHAT_ACTION_NOT_FOUND", {
            action,
        }),
);

export const HEYCHAT_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type HeychatPlatformAction =
    typeof HEYCHAT_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行官方扩展动作；参数名原样沿用开放平台，避免重复维护影子 DTO。 */
export async function executeHeychatPlatformAction(
    bot: HeychatBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
}

function requireApiPath(value: unknown): string {
    if (typeof value !== "string" || !isSafeHeychatApiPath(value)) {
        throw invalid(
            "path 必须是 /chatroom/v2/、/chatroom/v3/ 或 /chatroom/channel/ 下的安全绝对路径",
        );
    }
    return value;
}

function methodValue(value: unknown): HeychatApiRequestOptions["method"] {
    if (value === undefined) return "GET";
    if (typeof value !== "string") throw invalid("method 必须是 GET 或 POST");
    const method = value.toUpperCase();
    if (method !== "GET" && method !== "POST") throw invalid("method 必须是 GET 或 POST");
    return method;
}

function queryValue(
    value: unknown,
): Record<string, string | number | boolean | undefined> | undefined {
    const object = objectValue(value, "query");
    return object ? scalarParams(object) : undefined;
}

function objectValue(value: unknown, name: string): Readonly<Record<string, unknown>> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid(`${name} 必须是对象`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function scalarParams(
    params: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | undefined> {
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
            result[key] = undefined;
        } else if (typeof value === "string" || typeof value === "boolean") {
            result[key] = value;
        } else if (typeof value === "number" && Number.isFinite(value)) {
            result[key] = value;
        } else {
            throw invalid(`query 参数 ${key} 必须是标量`);
        }
    }
    return result;
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) throw invalid(`${name} 必须是非空字符串`);
    return value;
}

function optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    return requiredString(value, name);
}

const DURATION_PARAMS = ["room_id", "begin_time", "end_time", "appid"] as const;

function scopeValue(value: unknown): string[] {
    const scopes = typeof value === "string" ? value.split(/\s+/u) : value;
    if (
        !Array.isArray(scopes) ||
        !scopes.length ||
        scopes.some(scope => typeof scope !== "string" || !scope.trim())
    ) {
        throw invalid("scope 必须是非空字符串或非空字符串数组");
    }
    return scopes.map(scope => scope.trim());
}

function durationQuery(params: Readonly<Record<string, unknown>>): HeychatVoiceDurationQuery {
    return {
        room_id: optionalString(params.room_id, "room_id"),
        begin_time: optionalTimestamp(params.begin_time, "begin_time"),
        end_time: optionalTimestamp(params.end_time, "end_time"),
        appid: optionalString(params.appid, "appid"),
    };
}

function optionalTimestamp(value: unknown, name: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw invalid(`${name} 必须是非负秒级时间戳`);
    }
    return value;
}

function assertAllowedParams(
    params: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const unknown = Object.keys(params).filter(key => !allowed.includes(key));
    if (unknown.length) throw invalid(`不支持参数: ${unknown.join(", ")}`);
}

function invalid(message: string): HeychatApiError {
    return HeychatApiError.invalid(
        `黑盒语音平台动作参数错误: ${message}`,
        "HEYCHAT_INVALID_ACTION_PARAMS",
    );
}
