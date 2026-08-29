import type { HeychatBot } from "./bot.js";
import { HeychatApiError } from "./errors.js";
import type { HeychatApiRequestOptions } from "./types.js";

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
    create_channel: { path: "/chatroom/v3/channel/create", method: "POST" },
    delete_channel: { path: "/chatroom/v2/channel/delete", method: "POST" },
    start_voice_stream: { path: "/chatroom/v3/channel/stream/push", method: "POST" },
    stop_voice_stream: { path: "/chatroom/v3/channel/stream/stop", method: "POST" },
};

export const HEYCHAT_PLATFORM_ACTIONS = new Set([
    "call_heychat_api",
    "upload_media",
    ...Object.keys(ROUTES),
]);

/** 执行官方扩展动作；参数名原样沿用开放平台，避免重复维护影子 DTO。 */
export async function executeHeychatPlatformAction(
    bot: HeychatBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    if (action === "call_heychat_api") {
        return bot.callApi(requireApiPath(params.path), {
            method: methodValue(params.method),
            query: queryValue(params.query),
            body: objectValue(params.body, "body"),
        });
    }
    if (action === "upload_media") {
        const data = decodeBase64(requiredString(params.data, "data"));
        const filename = requiredString(params.filename, "filename");
        const contentType = optionalString(params.content_type, "content_type");
        return { url: await bot.uploadMedia(data, filename, contentType) };
    }
    const route = ROUTES[action];
    if (!route) throw new Error(`未实现黑盒语音平台动作: ${action}`);
    return bot.callApi(
        route.path,
        route.method === "GET"
            ? { query: scalarParams(params) }
            : { method: "POST", body: { ...params } },
    );
}

function requireApiPath(value: unknown): string {
    if (typeof value !== "string" || value.includes("..")) throw invalid("path 必须是安全路径");
    const allowed = ["/chatroom/v2/", "/chatroom/v3/", "/chatroom/channel/"];
    if (!allowed.some(prefix => value.startsWith(prefix))) {
        throw invalid(`path 仅允许 ${allowed.join("、")} 下的官方接口`);
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

function decodeBase64(value: string): Buffer {
    const normalized = value.replace(/^data:[^;]+;base64,/u, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) || normalized.length % 4 === 1) {
        throw invalid("data 必须是有效 Base64 或 Base64 data URL");
    }
    const data = Buffer.from(normalized, "base64");
    if (!data.byteLength) throw invalid("data 解码后为空");
    if (data.byteLength > 25 * 1024 * 1024) throw invalid("upload_media 最大支持 25 MiB");
    return data;
}

function invalid(message: string): HeychatApiError {
    return new HeychatApiError(`黑盒语音平台动作参数错误: ${message}`, {
        code: "HEYCHAT_INVALID_ACTION_PARAMS",
    });
}
