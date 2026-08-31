import type { QQClient } from "./client.js";
import type { QQActionHandler, QQActionParams } from "./platform-action-context.js";
import {
    optionalNumber,
    optionalRecord,
    optionalString,
    requiredRecord,
    requiredString,
} from "./platform-action-params.js";

/** 频道服务器成员、身份组和 API 权限动作。 */
export const QQ_GUILD_ACTIONS = {
    kick_guild_member: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "DELETE",
            path: `${guildMemberPath(params)}`,
            query: { add_blacklist: params.add_blacklist === true },
        }),
    mute_guild_member: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "PUT",
            path: `${guildMemberPath(params)}/mute`,
            body: { mute_seconds: String(optionalNumber(params.duration) ?? 0) },
        }),
    mute_guild: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "PUT",
            path: `/guilds/${requiredString(params, "guild_id")}/mute`,
            body: { mute_seconds: String(optionalNumber(params.duration) ?? 0) },
        }),
    get_guild_roles: guildRolesAction("GET"),
    create_guild_role: guildRolesAction("POST"),
    update_guild_role: guildRolesAction("PATCH", true),
    delete_guild_role: guildRolesAction("DELETE", true),
    add_guild_member_role: guildMemberRoleAction("PUT"),
    remove_guild_member_role: guildMemberRoleAction("DELETE"),
    get_channel_permission_of_role: channelPermissionAction("role", "GET"),
    update_channel_permission_of_role: channelPermissionAction("role", "PUT"),
    get_channel_member_permission: channelPermissionAction("member", "GET"),
    update_channel_member_permission: channelPermissionAction("member", "PUT"),
    get_guild_api_permissions: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: `/guilds/${requiredString(params, "guild_id")}/api_permission`,
        }),
    demand_guild_api_permission: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: `/guilds/${requiredString(params, "guild_id")}/api_permission/demand`,
            body: {
                channel_id: requiredString(params, "channel_id"),
                api_identify: requiredString(params, "api_identify"),
                desc: optionalString(params.description),
            },
        }),
} satisfies Readonly<Record<string, QQActionHandler>>;

function guildMemberPath(params: QQActionParams): string {
    return `/guilds/${requiredString(params, "guild_id")}/members/${requiredString(params, "member_id")}`;
}

function guildRolesAction(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    identified = false,
): QQActionHandler {
    return async (client, params) => {
        const path = `/guilds/${requiredString(params, "guild_id")}/roles${
            identified ? `/${requiredString(params, "role_id")}` : ""
        }`;
        if (method === "POST" || method === "PATCH") {
            return client.call({ method, path, body: requiredRecord(params, "role") });
        }
        return client.call({ method, path });
    };
}

function guildMemberRoleAction(method: "PUT" | "DELETE"): QQActionHandler {
    return async (client, params) =>
        client.call({
            method,
            path: `${guildMemberPath(params)}/roles/${requiredString(params, "role_id")}`,
            body: { id: optionalString(params.channel_id) },
        });
}

function channelPermissionAction(
    subject: "role" | "member",
    method: "GET" | "PUT",
): QQActionHandler {
    return async (client, params) =>
        client.call({
            method,
            path: `/channels/${requiredString(params, "channel_id")}/${subject}s/${requiredString(
                params,
                subject === "role" ? "role_id" : "member_id",
            )}/permissions`,
            body: optionalRecord(params.permission),
        });
}
