import {
    definePlatformActionHandlers,
    definePlatformActions,
    type PlatformActionHandler,
} from "onebots";
import type { HeychatBot } from "./bot.js";
import { isSafeHeychatApiPath } from "./api-path.js";
import { HeychatApiError } from "./errors.js";
import { normalizeBase64Source, uploadHeychatMedia } from "./media.js";
import { HEYCHAT_MESSAGE_PLATFORM_ACTIONS } from "./platform-actions-message.js";
import { HEYCHAT_ROLE_PLATFORM_ACTIONS } from "./platform-actions-role.js";
import { HEYCHAT_ROOM_PLATFORM_ACTIONS } from "./platform-actions-room.js";
import { HEYCHAT_VOICE_PLATFORM_ACTIONS } from "./platform-actions-voice.js";
import type { HeychatApiRequestOptions, HeychatVoiceDurationQuery } from "./types.js";

const DURATION_PARAMS = ["room_id", "begin_time", "end_time", "appid"] as const;

const SPECIAL_ACTION_HANDLERS = {
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
    create_oauth_authorization_url: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
        Promise.resolve({ url: bot.buildOAuthAuthorizationUrl(scopeValue(params.scope)) }),
    exchange_oauth_code: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
        bot.exchangeOAuthCode(requiredString(params.code, "code")),
    refresh_oauth_token: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
        bot.refreshOAuthToken(requiredString(params.refresh_token, "refresh_token")),
    get_oauth_user_info: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
        bot.getOAuthUserInfo(requiredString(params.access_token, "access_token")),
    request_oauth_user_info: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
        bot.requestOAuthUserInfo(
            requiredString(params.user_id, "user_id"),
            scopeValue(params.scope),
        ),
    get_oauth_voice_duration: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
        bot.getOAuthVoiceDuration(
            requiredString(params.access_token, "access_token"),
            durationQuery(params),
        ),
    get_oauth_game_duration: (bot: HeychatBot, params: Readonly<Record<string, unknown>>) =>
        bot.getOAuthVoiceDuration(requiredString(params.access_token, "access_token"), {
            ...durationQuery(params),
            appid: requiredString(params.appid, "appid"),
        }),
} satisfies Readonly<Record<string, PlatformActionHandler<HeychatBot>>>;

const SPECIAL_ACTIONS = definePlatformActionHandlers(
    SPECIAL_ACTION_HANDLERS,
    {
        call_heychat_api: ["path", "method", "query", "body"],
        upload_media: ["data", "filename", "content_type"],
        create_oauth_authorization_url: ["scope"],
        exchange_oauth_code: ["code"],
        refresh_oauth_token: ["refresh_token"],
        get_oauth_user_info: ["access_token"],
        request_oauth_user_info: ["user_id", "scope"],
        get_oauth_voice_duration: ["access_token", ...DURATION_PARAMS],
        get_oauth_game_duration: ["access_token", ...DURATION_PARAMS],
    },
    (action, parameter) =>
        HeychatApiError.invalid(
            `黑盒语音平台动作 ${action} 不接受参数 ${parameter}`,
            "HEYCHAT_UNEXPECTED_ACTION_PARAMETER",
            { action, parameter },
        ),
);

const PLATFORM_ACTIONS = definePlatformActions(
    {
        ...SPECIAL_ACTIONS,
        ...HEYCHAT_MESSAGE_PLATFORM_ACTIONS,
        ...HEYCHAT_ROLE_PLATFORM_ACTIONS,
        ...HEYCHAT_ROOM_PLATFORM_ACTIONS,
        ...HEYCHAT_VOICE_PLATFORM_ACTIONS,
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

function invalid(message: string): HeychatApiError {
    return HeychatApiError.invalid(
        `黑盒语音平台动作参数错误: ${message}`,
        "HEYCHAT_INVALID_ACTION_PARAMS",
    );
}
