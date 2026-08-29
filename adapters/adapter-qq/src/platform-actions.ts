import type { ReplyTarget } from "@tencent-connect/qqbot-nodejs";
import type { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import type { QQPlatformCall } from "./types.js";

export const QQ_PLATFORM_ACTIONS = [
    "qq_call",
    "send_wakeup",
    "send_typing",
    "acknowledge_interaction",
    "approve_group_join_request",
    "get_group_join_requests",
    "get_group_restrict_chat",
    "set_group_restrict_chat",
    "get_group_bot_state",
    "get_group_join_approval_strategies",
    "create_group_join_approval_strategy",
    "update_group_join_approval_strategy",
    "delete_group_join_approval_strategy",
    "execute_group_join_approval_strategy",
    "update_group_join_approval_whitelist",
    "kick_guild_member",
    "mute_guild_member",
    "mute_guild",
    "get_guild_roles",
    "create_guild_role",
    "update_guild_role",
    "delete_guild_role",
    "add_guild_member_role",
    "remove_guild_member_role",
    "set_channel_announce",
    "get_channel_pins",
    "pin_channel_message",
    "unpin_channel_message",
    "add_reaction",
    "remove_reaction",
    "get_reaction_members",
    "get_schedules",
    "get_schedule",
    "create_schedule",
    "update_schedule",
    "delete_schedule",
    "get_channel_threads",
    "get_channel_thread",
    "publish_thread",
    "delete_thread",
    "control_channel_audio",
    "put_channel_microphone",
    "delete_channel_microphone",
    "get_channel_permission_of_role",
    "update_channel_permission_of_role",
    "get_channel_member_permission",
    "update_channel_member_permission",
    "get_guild_api_permissions",
    "demand_guild_api_permission",
    "get_bot_menu",
    "update_bot_menu",
    "list_bot_panels",
    "create_bot_panel",
    "get_bot_panel",
    "update_bot_panel",
    "delete_bot_panel",
    "publish_bot_panel",
] as const;

export type QQPlatformAction = (typeof QQ_PLATFORM_ACTIONS)[number];

export async function executeQQPlatformAction(
    client: QQClient,
    action: QQPlatformAction,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "qq_call":
            return client.call(readPlatformCall(params));
        case "send_wakeup":
            return client.sendWakeup(target(params), requiredString(params, "content"));
        case "send_typing":
            return client.sendTyping(target(params), optionalNumber(params.duration) ?? 5);
        case "acknowledge_interaction":
            return client.acknowledgeInteraction(
                requiredString(params, "interaction_id"),
                optionalNumber(params.code),
                optionalRecord(params.data),
            );
        case "approve_group_join_request":
            return client.call({
                method: "POST",
                path: `/v2/groups/${requiredString(params, "group_id")}/approval_join_request/${requiredString(params, "member_openid")}`,
                body: {
                    op: params.approve === false ? "decline" : "approve",
                    join_request_id: requiredString(params, "join_request_id"),
                    reject_reason: optionalString(params.reject_reason),
                },
            });
        case "get_group_join_requests":
            return client.call({
                method: "GET",
                path: `/v2/groups/${requiredString(params, "group_id")}/join_request_list`,
                query: optionalRecord(params.query) as
                    | Record<string, string | number | boolean>
                    | undefined,
            });
        case "get_group_restrict_chat":
            return client.call({
                method: "GET",
                path: `/v2/groups/${requiredString(params, "group_id")}/restrict_chat_setting`,
            });
        case "set_group_restrict_chat":
            return client.call({
                method: "POST",
                path: `/v2/groups/${requiredString(params, "group_id")}/restrict_chat_setting`,
                body: { members: requiredArray(params, "members") },
            });
        case "get_group_bot_state":
            return client.call({
                method: "GET",
                path: `/v2/groups/${requiredString(params, "group_id")}/bot_state`,
            });
        case "get_group_join_approval_strategies":
            return client.call({
                method: "GET",
                path: "/v2/groups/join_approval_strategy",
                query: optionalRecord(params.query) as QQPlatformCall["query"],
            });
        case "create_group_join_approval_strategy":
            return client.call({
                method: "POST",
                path: "/v2/groups/join_approval_strategy",
                body: requiredRecord(params, "strategy"),
            });
        case "update_group_join_approval_strategy":
            return client.call({
                method: "PATCH",
                path: `/v2/groups/join_approval_strategy/${requiredString(params, "strategy_id")}`,
                body: requiredRecord(params, "strategy"),
            });
        case "delete_group_join_approval_strategy":
            return client.call({
                method: "DELETE",
                path: `/v2/groups/join_approval_strategy/${requiredString(params, "strategy_id")}`,
            });
        case "execute_group_join_approval_strategy":
            return client.call({
                method: "POST",
                path: `/v2/groups/join_approval_strategy/${requiredString(params, "strategy_id")}/execute`,
                body: {},
            });
        case "update_group_join_approval_whitelist":
            return client.call({
                method: "POST",
                path: `/v2/groups/join_approval_strategy/${requiredString(params, "strategy_id")}/whitelist_users`,
                body: requiredRecord(params, "whitelist"),
            });
        case "kick_guild_member":
            return client.call({
                method: "DELETE",
                path: `/guilds/${requiredString(params, "guild_id")}/members/${requiredString(params, "member_id")}?add_blacklist=${params.add_blacklist === true}`,
            });
        case "mute_guild_member":
            return client.call({
                method: "PUT",
                path: `/guilds/${requiredString(params, "guild_id")}/members/${requiredString(params, "member_id")}/mute`,
                body: { mute_seconds: String(optionalNumber(params.duration) ?? 0) },
            });
        case "mute_guild":
            return client.call({
                method: "PUT",
                path: `/guilds/${requiredString(params, "guild_id")}/mute`,
                body: { mute_seconds: String(optionalNumber(params.duration) ?? 0) },
            });
        case "get_guild_roles":
            return client.call({
                method: "GET",
                path: `/guilds/${requiredString(params, "guild_id")}/roles`,
            });
        case "create_guild_role":
            return client.call({
                method: "POST",
                path: `/guilds/${requiredString(params, "guild_id")}/roles`,
                body: requiredRecord(params, "role"),
            });
        case "update_guild_role":
            return client.call({
                method: "PATCH",
                path: `/guilds/${requiredString(params, "guild_id")}/roles/${requiredString(params, "role_id")}`,
                body: requiredRecord(params, "role"),
            });
        case "delete_guild_role":
            return client.call({
                method: "DELETE",
                path: `/guilds/${requiredString(params, "guild_id")}/roles/${requiredString(params, "role_id")}`,
            });
        case "add_guild_member_role":
        case "remove_guild_member_role":
            return client.call({
                method: action === "add_guild_member_role" ? "PUT" : "DELETE",
                path: `/guilds/${requiredString(params, "guild_id")}/members/${requiredString(params, "member_id")}/roles/${requiredString(params, "role_id")}`,
                body: { id: optionalString(params.channel_id) },
            });
        case "set_channel_announce":
            return client.call({
                method: "POST",
                path: `/guilds/${requiredString(params, "guild_id")}/announces`,
                body: {
                    channel_id: requiredString(params, "channel_id"),
                    message_id: requiredString(params, "message_id"),
                },
            });
        case "get_channel_pins":
            return client.call({
                method: "GET",
                path: `/channels/${requiredString(params, "channel_id")}/pins`,
            });
        case "pin_channel_message":
        case "unpin_channel_message":
            return client.call({
                method: action === "pin_channel_message" ? "PUT" : "DELETE",
                path: `/channels/${requiredString(params, "channel_id")}/pins/${requiredString(params, "message_id")}`,
            });
        case "add_reaction":
        case "remove_reaction":
            return client.call({
                method: action === "add_reaction" ? "PUT" : "DELETE",
                path: reactionPath(params),
            });
        case "get_reaction_members":
            return client.call({
                method: "GET",
                path: reactionPath(params),
                query: optionalRecord(params.query) as
                    | Record<string, string | number | boolean>
                    | undefined,
            });
        case "get_schedules":
            return client.call({
                method: "GET",
                path: `/channels/${requiredString(params, "channel_id")}/schedules`,
                query: optionalRecord(params.query) as
                    | Record<string, string | number | boolean>
                    | undefined,
            });
        case "get_schedule":
            return client.call({ method: "GET", path: schedulePath(params) });
        case "create_schedule":
            return client.call({
                method: "POST",
                path: `/channels/${requiredString(params, "channel_id")}/schedules`,
                body: { schedule: requiredRecord(params, "schedule") },
            });
        case "update_schedule":
            return client.call({
                method: "PATCH",
                path: schedulePath(params),
                body: { schedule: requiredRecord(params, "schedule") },
            });
        case "delete_schedule":
            return client.call({ method: "DELETE", path: schedulePath(params) });
        case "get_channel_threads":
            return client.call({
                method: "GET",
                path: `/channels/${requiredString(params, "channel_id")}/threads`,
            });
        case "get_channel_thread":
            return client.call({ method: "GET", path: threadPath(params) });
        case "publish_thread":
            return client.call({
                method: "POST",
                path: `/channels/${requiredString(params, "channel_id")}/threads`,
                body: {
                    title: requiredString(params, "title"),
                    content: requiredString(params, "content"),
                    format: optionalNumber(params.format) ?? 1,
                },
            });
        case "delete_thread":
            return client.call({ method: "DELETE", path: threadPath(params) });
        case "control_channel_audio":
            return client.call({
                method: "POST",
                path: `/channels/${requiredString(params, "channel_id")}/audio`,
                body: requiredRecord(params, "control"),
            });
        case "put_channel_microphone":
        case "delete_channel_microphone":
            return client.call({
                method: action === "put_channel_microphone" ? "PUT" : "DELETE",
                path: `/channels/${requiredString(params, "channel_id")}/mic`,
            });
        case "get_channel_permission_of_role":
        case "update_channel_permission_of_role":
            return client.call({
                method: action.startsWith("get_") ? "GET" : "PUT",
                path: `/channels/${requiredString(params, "channel_id")}/roles/${requiredString(params, "role_id")}/permissions`,
                body: optionalRecord(params.permission),
            });
        case "get_channel_member_permission":
        case "update_channel_member_permission":
            return client.call({
                method: action.startsWith("get_") ? "GET" : "PUT",
                path: `/channels/${requiredString(params, "channel_id")}/members/${requiredString(params, "member_id")}/permissions`,
                body: optionalRecord(params.permission),
            });
        case "get_guild_api_permissions":
            return client.call({
                method: "GET",
                path: `/guilds/${requiredString(params, "guild_id")}/api_permission`,
            });
        case "demand_guild_api_permission":
            return client.call({
                method: "POST",
                path: `/guilds/${requiredString(params, "guild_id")}/api_permission/demand`,
                body: {
                    channel_id: requiredString(params, "channel_id"),
                    api_identify: requiredString(params, "api_identify"),
                    desc: optionalString(params.description),
                },
            });
        case "get_bot_menu":
            return client.call({ method: "GET", path: "/v2/menu" });
        case "update_bot_menu":
            return client.call({
                method: "PUT",
                path: "/v2/menu",
                body: { menu: requiredRecord(params, "menu") },
            });
        case "list_bot_panels":
            return client.call({
                method: "GET",
                path: "/v2/panels",
                query: optionalRecord(params.query) as QQPlatformCall["query"],
            });
        case "create_bot_panel":
            return client.call({
                method: "POST",
                path: "/v2/panels",
                body: requiredRecord(params, "panel"),
            });
        case "get_bot_panel":
            return client.call({
                method: "GET",
                path: `/v2/panels/${requiredString(params, "panel_id")}`,
            });
        case "update_bot_panel":
            return client.call({
                method: "PUT",
                path: `/v2/panels/${requiredString(params, "panel_id")}`,
                body: { panel: requiredRecord(params, "panel") },
            });
        case "delete_bot_panel":
            return client.call({
                method: "DELETE",
                path: `/v2/panels/${requiredString(params, "panel_id")}`,
            });
        case "publish_bot_panel":
            return client.call({
                method: "PUT",
                path: `/v2/panels/${requiredString(params, "panel_id")}/target`,
                body: requiredRecord(params, "target"),
            });
    }
}

function target(params: Readonly<Record<string, unknown>>): ReplyTarget {
    const scope = requiredString(params, "scope");
    if (scope !== "c2c" && scope !== "group") throw invalid("scope 必须是 c2c 或 group");
    return {
        scope,
        targetId: requiredString(params, "target_id"),
        msgId: optionalString(params.msg_id),
    };
}

function readPlatformCall(params: Readonly<Record<string, unknown>>): QQPlatformCall {
    const method = requiredString(params, "method").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw invalid("method 非法");
    return {
        method: method as QQPlatformCall["method"],
        path: requiredString(params, "path"),
        query: optionalRecord(params.query) as QQPlatformCall["query"],
        body: params.body,
    };
}

function reactionPath(params: Readonly<Record<string, unknown>>): string {
    return `/channels/${requiredString(params, "channel_id")}/messages/${requiredString(params, "message_id")}/reactions/${requiredString(params, "emoji_type")}/${requiredString(params, "emoji_id")}`;
}

function schedulePath(params: Readonly<Record<string, unknown>>): string {
    return `/channels/${requiredString(params, "channel_id")}/schedules/${requiredString(params, "schedule_id")}`;
}

function threadPath(params: Readonly<Record<string, unknown>>): string {
    return `/channels/${requiredString(params, "channel_id")}/threads/${requiredString(params, "thread_id")}`;
}

function requiredString(params: Readonly<Record<string, unknown>>, key: string): string {
    const value = optionalString(params[key]);
    if (!value) throw invalid(`缺少 ${key}`);
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    if (value == null) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) throw invalid("数字参数非法");
    return number;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function requiredRecord(
    params: Readonly<Record<string, unknown>>,
    key: string,
): Record<string, unknown> {
    const value = optionalRecord(params[key]);
    if (!value) throw invalid(`缺少对象参数 ${key}`);
    return value;
}

function requiredArray(params: Readonly<Record<string, unknown>>, key: string): unknown[] {
    const value = params[key];
    if (!Array.isArray(value)) throw invalid(`缺少数组参数 ${key}`);
    return value;
}

function invalid(message: string): QQApiError {
    return new QQApiError(message, { code: "QQ_INVALID_ACTION_PARAMS" });
}
