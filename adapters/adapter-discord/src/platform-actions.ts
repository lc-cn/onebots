import type { DiscordBot } from "./bot.js";

export const DISCORD_PLATFORM_ACTIONS = new Set([
    "ban_member",
    "unban_member",
    "get_guild_bans",
    "get_guild_roles",
    "create_guild_role",
    "update_guild_role",
    "delete_guild_role",
    "add_guild_member_role",
    "remove_guild_member_role",
    "bulk_delete_messages",
    "crosspost_message",
    "get_channel_pins",
    "pin_message",
    "unpin_message",
    "trigger_typing",
    "create_thread",
    "join_thread",
    "leave_thread",
    "add_thread_member",
    "remove_thread_member",
    "list_thread_members",
    "get_active_threads",
    "get_channel_invites",
    "create_channel_invite",
    "delete_invite",
    "get_reaction_users",
]);

/** Discord v10 平台扩展动作，按官方资源边界直接映射 REST endpoint。 */
export async function executeDiscordPlatformAction(
    bot: DiscordBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const rest = bot.getREST();
    const channelId = () => requireSnowflake(params, "channel_id");
    const guildId = () => requireSnowflake(params, "guild_id");
    const userId = () => requireSnowflake(params, "user_id");
    const messageId = () => requireSnowflake(params, "message_id");
    switch (action) {
        case "ban_member":
            return bot.banMember(guildId(), userId(), {
                deleteMessageSeconds: optionalInteger(params, "delete_message_seconds"),
            });
        case "unban_member":
            return bot.unbanMember(guildId(), userId());
        case "get_guild_bans":
            return rest.request(`/guilds/${guildId()}/bans`, { query: query(params) });
        case "get_guild_roles":
            return rest.request(`/guilds/${guildId()}/roles`);
        case "create_guild_role":
            return rest.request(`/guilds/${guildId()}/roles`, {
                method: "POST",
                body: requireObject(params, "role"),
            });
        case "update_guild_role":
            return rest.request(
                `/guilds/${guildId()}/roles/${requireSnowflake(params, "role_id")}`,
                { method: "PATCH", body: requireObject(params, "role") },
            );
        case "delete_guild_role":
            return rest.request(
                `/guilds/${guildId()}/roles/${requireSnowflake(params, "role_id")}`,
                { method: "DELETE" },
            );
        case "add_guild_member_role":
        case "remove_guild_member_role":
            return rest.request(
                `/guilds/${guildId()}/members/${userId()}/roles/${requireSnowflake(params, "role_id")}`,
                { method: action === "add_guild_member_role" ? "PUT" : "DELETE" },
            );
        case "bulk_delete_messages":
            return rest.request(`/channels/${channelId()}/messages/bulk-delete`, {
                method: "POST",
                body: { messages: requireSnowflakeArray(params, "message_ids", 2, 100) },
            });
        case "crosspost_message":
            return rest.request(`/channels/${channelId()}/messages/${messageId()}/crosspost`, {
                method: "POST",
            });
        case "get_channel_pins":
            return rest.request(`/channels/${channelId()}/messages/pins`, { query: query(params) });
        case "pin_message":
        case "unpin_message":
            return rest.request(`/channels/${channelId()}/messages/pins/${messageId()}`, {
                method: action === "pin_message" ? "PUT" : "DELETE",
            });
        case "trigger_typing":
            return rest.request(`/channels/${channelId()}/typing`, { method: "POST" });
        case "create_thread": {
            const parent = channelId();
            const sourceMessage = optionalSnowflake(params, "message_id");
            return rest.request(
                sourceMessage
                    ? `/channels/${parent}/messages/${sourceMessage}/threads`
                    : `/channels/${parent}/threads`,
                { method: "POST", body: requireObject(params, "thread") },
            );
        }
        case "join_thread":
        case "leave_thread":
            return rest.request(`/channels/${channelId()}/thread-members/@me`, {
                method: action === "join_thread" ? "PUT" : "DELETE",
            });
        case "add_thread_member":
        case "remove_thread_member":
            return rest.request(`/channels/${channelId()}/thread-members/${userId()}`, {
                method: action === "add_thread_member" ? "PUT" : "DELETE",
            });
        case "list_thread_members":
            return rest.request(`/channels/${channelId()}/thread-members`, {
                query: query(params),
            });
        case "get_active_threads":
            return rest.request(`/guilds/${guildId()}/threads/active`);
        case "get_channel_invites":
            return rest.request(`/channels/${channelId()}/invites`);
        case "create_channel_invite":
            return rest.request(`/channels/${channelId()}/invites`, {
                method: "POST",
                body: params.invite && typeof params.invite === "object" ? params.invite : {},
            });
        case "delete_invite":
            return rest.request(`/invites/${requireString(params, "code")}`, { method: "DELETE" });
        case "get_reaction_users":
            return rest.request(
                `/channels/${channelId()}/messages/${messageId()}/reactions/${encodeURIComponent(requireString(params, "emoji"))}`,
                { query: query(params) },
            );
        default:
            throw new Error(`未实现 Discord 平台动作: ${action}`);
    }
}

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) throw new Error(`Discord 参数 ${name} 必须为字符串`);
    return value;
}

function requireSnowflake(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = String(params[name] ?? "");
    if (!/^\d+$/.test(value)) throw new Error(`Discord 参数 ${name} 必须为 Snowflake`);
    return value;
}

function optionalSnowflake(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    return params[name] == null ? undefined : requireSnowflake(params, name);
}

function requireSnowflakeArray(
    params: Readonly<Record<string, unknown>>,
    name: string,
    minimum: number,
    maximum: number,
): string[] {
    const value = params[name];
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
        throw new Error(`Discord 参数 ${name} 数量必须为 ${minimum}-${maximum}`);
    }
    return value.map(item => {
        const snowflake = String(item);
        if (!/^\d+$/.test(snowflake)) throw new Error(`Discord 参数 ${name} 包含无效 Snowflake`);
        return snowflake;
    });
}

function requireObject(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Readonly<Record<string, unknown>> {
    const value = params[name];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Discord 参数 ${name} 必须为对象`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function optionalInteger(
    params: Readonly<Record<string, unknown>>,
    name: string,
): number | undefined {
    if (params[name] == null) return undefined;
    const value = Number(params[name]);
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`Discord 参数 ${name} 必须为非负整数`);
    return value;
}

function query(params: Readonly<Record<string, unknown>>): Record<string, string> {
    const source = params.query;
    if (typeof source !== "object" || source === null || Array.isArray(source)) return {};
    return Object.fromEntries(
        Object.entries(source).flatMap(([key, value]) =>
            value == null ? [] : [[key, String(value)]],
        ),
    );
}
