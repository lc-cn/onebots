import type { DiscordBot } from "./bot.js";
import { assertDiscordEndpoint } from "./lite/rest.js";
import { DiscordError } from "./errors.js";

const DISCORD_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type DiscordMethod = (typeof DISCORD_METHODS)[number];

export const DISCORD_PLATFORM_ACTIONS = new Set([
    "call_discord_api",
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
    "add_reaction",
    "remove_own_reaction",
    "leave_guild",
    "kick_guild_member",
    "timeout_guild_member",
    "set_guild_member_nickname",
    "create_interaction_response",
    "get_original_interaction_response",
    "edit_original_interaction_response",
    "create_followup_message",
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
        case "call_discord_api":
            return rest.request(requirePath(params.path), {
                method: methodValue(params.method),
                body: optionalObject(params.body, "body"),
                query: query(params),
                reason: optionalString(params, "reason"),
            });
        case "ban_member":
            return bot.banMember(guildId(), userId(), {
                deleteMessageSeconds: optionalInteger(params, "delete_message_seconds"),
                reason: optionalString(params, "reason"),
            });
        case "unban_member":
            return bot.unbanMember(guildId(), userId(), optionalString(params, "reason"));
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
                body: optionalObject(params.invite, "invite") ?? {},
            });
        case "delete_invite":
            return rest.request(`/invites/${requireString(params, "code")}`, { method: "DELETE" });
        case "get_reaction_users":
            return rest.request(
                `/channels/${channelId()}/messages/${messageId()}/reactions/${encodeURIComponent(requireString(params, "emoji"))}`,
                { query: query(params) },
            );
        case "add_reaction":
        case "remove_own_reaction":
            return rest.request(
                `/channels/${channelId()}/messages/${messageId()}/reactions/${encodeURIComponent(requireString(params, "emoji"))}/@me`,
                { method: action === "add_reaction" ? "PUT" : "DELETE" },
            );
        case "leave_guild":
            return rest.request(`/users/@me/guilds/${guildId()}`, { method: "DELETE" });
        case "kick_guild_member":
            return bot.kickMember(guildId(), userId(), optionalString(params, "reason"));
        case "timeout_guild_member": {
            const duration = optionalInteger(params, "duration") ?? 0;
            const reason = optionalString(params, "reason");
            if (duration > 0) {
                return reason
                    ? bot.timeoutMember(guildId(), userId(), duration, reason)
                    : bot.timeoutMember(guildId(), userId(), duration);
            }
            return reason
                ? bot.removeTimeout(guildId(), userId(), reason)
                : bot.removeTimeout(guildId(), userId());
        }
        case "set_guild_member_nickname": {
            const args = [guildId(), userId(), optionalString(params, "nickname") ?? null] as const;
            const reason = optionalString(params, "reason");
            return reason ? bot.setMemberNickname(...args, reason) : bot.setMemberNickname(...args);
        }
        case "create_interaction_response":
            return rest.createInteractionResponse(
                requireSnowflake(params, "interaction_id"),
                requireString(params, "interaction_token"),
                requireObject(params, "response") as { type: number; data?: unknown },
            );
        case "get_original_interaction_response":
            return rest.getOriginalInteractionResponse(
                requireSnowflake(params, "application_id"),
                requireString(params, "interaction_token"),
            );
        case "edit_original_interaction_response":
            return rest.editOriginalInteractionResponse(
                requireSnowflake(params, "application_id"),
                requireString(params, "interaction_token"),
                requireObject(params, "content"),
            );
        case "create_followup_message":
            return rest.createFollowupMessage(
                requireSnowflake(params, "application_id"),
                requireString(params, "interaction_token"),
                requireObject(params, "content"),
            );
        default:
            throw DiscordError.invalid(
                `未实现 Discord 平台动作：${action}`,
                "DISCORD_ACTION_UNSUPPORTED",
            );
    }
}

function requirePath(value: unknown): string {
    assertDiscordEndpoint(value, "Discord 参数 path");
    return value;
}

function methodValue(value: unknown): DiscordMethod {
    const method = typeof value === "string" ? value.toUpperCase() : "GET";
    if (!isDiscordMethod(method)) {
        throw invalidParameter("Discord 参数 method 不是受支持的 HTTP 方法");
    }
    return method;
}

function isDiscordMethod(value: string): value is DiscordMethod {
    return (DISCORD_METHODS as readonly string[]).includes(value);
}

function optionalObject(
    value: unknown,
    name: string,
): Readonly<Record<string, unknown>> | undefined {
    if (value == null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) {
        throw invalidParameter(`Discord 参数 ${name} 必须为对象`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) {
        throw invalidParameter(`Discord 参数 ${name} 必须为字符串`);
    }
    return value;
}

function requireSnowflake(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = String(params[name] ?? "");
    if (!/^\d+$/.test(value)) throw invalidParameter(`Discord 参数 ${name} 必须为 Snowflake`);
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
        throw invalidParameter(`Discord 参数 ${name} 数量必须为 ${minimum}-${maximum}`);
    }
    return value.map(item => {
        const snowflake = String(item);
        if (!/^\d+$/.test(snowflake)) {
            throw invalidParameter(`Discord 参数 ${name} 包含无效 Snowflake`);
        }
        return snowflake;
    });
}

function requireObject(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Readonly<Record<string, unknown>> {
    const value = params[name];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw invalidParameter(`Discord 参数 ${name} 必须为对象`);
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
        throw invalidParameter(`Discord 参数 ${name} 必须为非负整数`);
    return value;
}

function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    if (params[name] == null) return undefined;
    const value = params[name];
    if (typeof value !== "string") throw invalidParameter(`Discord 参数 ${name} 必须为字符串`);
    return value;
}

function query(params: Readonly<Record<string, unknown>>): Record<string, string> {
    const source = params.query;
    if (typeof source !== "object" || source === null || Array.isArray(source)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
        if (value == null) continue;
        if (!isScalar(value)) {
            throw invalidParameter(`Discord query 参数 ${key} 必须为标量`);
        }
        result[key] = String(value);
    }
    return result;
}

function isScalar(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function invalidParameter(message: string): DiscordError {
    return DiscordError.invalid(message, "DISCORD_ACTION_PARAMS_INVALID");
}
