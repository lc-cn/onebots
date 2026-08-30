import type { DiscordBot } from "./bot.js";
import { definePlatformActions, type PlatformActionHandler } from "onebots";
import { assertDiscordEndpoint } from "./lite/rest.js";
import { DiscordError } from "./errors.js";
import { parseDiscordGatewayCommand } from "./lite/gateway-commands.js";
import { DISCORD_COMMUNITY_ACTIONS } from "./platform-actions-community.js";
import {
    optionalInteger,
    optionalSnowflake,
    optionalString,
    query,
    requireObject,
    requireSnowflake,
    requireSnowflakeArray,
    requireString,
    type DiscordActionParams as Params,
} from "./platform-action-params.js";

const DISCORD_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type DiscordMethod = (typeof DISCORD_METHODS)[number];
type Handler = PlatformActionHandler<DiscordBot>;

const PLATFORM_ACTIONS = definePlatformActions(
    {
        ...DISCORD_COMMUNITY_ACTIONS,
        call_discord_api: async (bot: DiscordBot, params: Params) =>
            bot.getREST().request(requirePath(params.path), {
                method: methodValue(params.method),
                body: optionalObject(params.body, "body"),
                query: query(params),
                reason: optionalString(params, "reason"),
            }),
        send_gateway_command: async (bot: DiscordBot, params: Params) =>
            bot.sendGatewayCommand(parseDiscordGatewayCommand(params.command)),
        ban_member: async (bot: DiscordBot, params: Params) =>
            bot.banMember(guildId(params), userId(params), {
                deleteMessageSeconds: optionalInteger(params, "delete_message_seconds"),
                reason: optionalString(params, "reason"),
            }),
        unban_member: async (bot: DiscordBot, params: Params) =>
            bot.unbanMember(guildId(params), userId(params), optionalString(params, "reason")),
        get_guild_bans: restAction(params => `/guilds/${guildId(params)}/bans`, {
            query: true,
        }),
        get_guild_roles: restAction(params => `/guilds/${guildId(params)}/roles`),
        create_guild_role: restAction(params => `/guilds/${guildId(params)}/roles`, {
            method: "POST",
            body: "role",
        }),
        update_guild_role: restAction(
            params => `/guilds/${guildId(params)}/roles/${requireSnowflake(params, "role_id")}`,
            { method: "PATCH", body: "role" },
        ),
        delete_guild_role: restAction(
            params => `/guilds/${guildId(params)}/roles/${requireSnowflake(params, "role_id")}`,
            { method: "DELETE" },
        ),
        add_guild_member_role: guildMemberRole("PUT"),
        remove_guild_member_role: guildMemberRole("DELETE"),
        bulk_delete_messages: async (bot: DiscordBot, params: Params) =>
            bot.getREST().request(`/channels/${channelId(params)}/messages/bulk-delete`, {
                method: "POST",
                body: { messages: requireSnowflakeArray(params, "message_ids", 2, 100) },
            }),
        crosspost_message: restAction(
            params => `/channels/${channelId(params)}/messages/${messageId(params)}/crosspost`,
            { method: "POST" },
        ),
        get_channel_pins: restAction(params => `/channels/${channelId(params)}/messages/pins`, {
            query: true,
        }),
        pin_message: pinAction("PUT"),
        unpin_message: pinAction("DELETE"),
        trigger_typing: restAction(params => `/channels/${channelId(params)}/typing`, {
            method: "POST",
        }),
        create_thread: createThread,
        join_thread: ownThreadMembership("PUT"),
        leave_thread: ownThreadMembership("DELETE"),
        add_thread_member: threadMembership("PUT"),
        remove_thread_member: threadMembership("DELETE"),
        list_thread_members: restAction(params => `/channels/${channelId(params)}/thread-members`, {
            query: true,
        }),
        get_active_threads: restAction(params => `/guilds/${guildId(params)}/threads/active`),
        get_channel_invites: restAction(params => `/channels/${channelId(params)}/invites`),
        create_channel_invite: async (bot: DiscordBot, params: Params) =>
            bot.getREST().request(`/channels/${channelId(params)}/invites`, {
                method: "POST",
                body: optionalObject(params.invite, "invite") ?? {},
            }),
        delete_invite: restAction(params => `/invites/${requireString(params, "code")}`, {
            method: "DELETE",
        }),
        get_reaction_users: reactionAction("GET"),
        add_reaction: reactionAction("PUT", true),
        remove_own_reaction: reactionAction("DELETE", true),
        leave_guild: restAction(params => `/users/@me/guilds/${guildId(params)}`, {
            method: "DELETE",
        }),
        kick_guild_member: async (bot: DiscordBot, params: Params) =>
            bot.kickMember(guildId(params), userId(params), optionalString(params, "reason")),
        timeout_guild_member: timeoutGuildMember,
        set_guild_member_nickname: setGuildMemberNickname,
        create_interaction_response: async (bot: DiscordBot, params: Params) =>
            bot
                .getREST()
                .createInteractionResponse(
                    requireSnowflake(params, "interaction_id"),
                    requireString(params, "interaction_token"),
                    requireObject(params, "response") as { type: number; data?: unknown },
                ),
        get_original_interaction_response: async (bot: DiscordBot, params: Params) =>
            bot
                .getREST()
                .getOriginalInteractionResponse(
                    requireSnowflake(params, "application_id"),
                    requireString(params, "interaction_token"),
                ),
        edit_original_interaction_response: async (bot: DiscordBot, params: Params) =>
            bot
                .getREST()
                .editOriginalInteractionResponse(
                    requireSnowflake(params, "application_id"),
                    requireString(params, "interaction_token"),
                    requireObject(params, "content"),
                ),
        delete_original_interaction_response: interactionWebhookMessage("DELETE", "@original"),
        create_followup_message: async (bot: DiscordBot, params: Params) =>
            bot
                .getREST()
                .createFollowupMessage(
                    requireSnowflake(params, "application_id"),
                    requireString(params, "interaction_token"),
                    requireObject(params, "content"),
                ),
        get_followup_message: interactionWebhookMessage("GET"),
        edit_followup_message: interactionWebhookMessage("PATCH"),
        delete_followup_message: interactionWebhookMessage("DELETE"),
    },
    action =>
        DiscordError.invalid(`未实现 Discord 平台动作：${action}`, "DISCORD_ACTION_UNSUPPORTED", {
            action,
        }),
);

export const DISCORD_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type DiscordPlatformAction =
    typeof DISCORD_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** Discord v10 平台扩展动作，按官方资源边界直接映射 REST endpoint。 */
export async function executeDiscordPlatformAction(
    bot: DiscordBot,
    action: string,
    params: Params,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(bot, action, params);
}

interface RestActionOptions {
    method?: DiscordMethod;
    body?: string;
    query?: boolean;
}

function restAction(path: (params: Params) => string, options: RestActionOptions = {}): Handler {
    return async (bot, params) =>
        bot.getREST().request(path(params), {
            method: options.method,
            body: options.body ? requireObject(params, options.body) : undefined,
            query: options.query ? query(params) : undefined,
        });
}

function guildMemberRole(method: "PUT" | "DELETE"): Handler {
    return restAction(
        params =>
            `/guilds/${guildId(params)}/members/${userId(params)}/roles/${requireSnowflake(params, "role_id")}`,
        { method },
    );
}

function pinAction(method: "PUT" | "DELETE"): Handler {
    return restAction(
        params => `/channels/${channelId(params)}/messages/pins/${messageId(params)}`,
        { method },
    );
}

function ownThreadMembership(method: "PUT" | "DELETE"): Handler {
    return restAction(params => `/channels/${channelId(params)}/thread-members/@me`, {
        method,
    });
}

function threadMembership(method: "PUT" | "DELETE"): Handler {
    return restAction(params => `/channels/${channelId(params)}/thread-members/${userId(params)}`, {
        method,
    });
}

function reactionAction(method: "GET" | "PUT" | "DELETE", own = false): Handler {
    return restAction(
        params =>
            `/channels/${channelId(params)}/messages/${messageId(params)}/reactions/${encodeURIComponent(requireString(params, "emoji"))}${own ? "/@me" : ""}`,
        { method: method === "GET" ? undefined : method, query: method === "GET" },
    );
}

function interactionWebhookMessage(
    method: "GET" | "PATCH" | "DELETE",
    fixedMessageId?: "@original",
): Handler {
    return async (bot, params) => {
        const applicationId = requireSnowflake(params, "application_id");
        const token = encodeURIComponent(requireString(params, "interaction_token"));
        const messageId = fixedMessageId ?? requireSnowflake(params, "message_id");
        return bot.getREST().request(`/webhooks/${applicationId}/${token}/messages/${messageId}`, {
            method: method === "GET" ? undefined : method,
            body: method === "PATCH" ? requireObject(params, "content") : undefined,
        });
    };
}

async function createThread(bot: DiscordBot, params: Params): Promise<unknown> {
    const parent = channelId(params);
    const sourceMessage = optionalSnowflake(params, "message_id");
    return bot
        .getREST()
        .request(
            sourceMessage
                ? `/channels/${parent}/messages/${sourceMessage}/threads`
                : `/channels/${parent}/threads`,
            { method: "POST", body: requireObject(params, "thread") },
        );
}

async function timeoutGuildMember(bot: DiscordBot, params: Params): Promise<unknown> {
    const duration = optionalInteger(params, "duration") ?? 0;
    const reason = optionalString(params, "reason");
    if (duration > 0) {
        return reason
            ? bot.timeoutMember(guildId(params), userId(params), duration, reason)
            : bot.timeoutMember(guildId(params), userId(params), duration);
    }
    return reason
        ? bot.removeTimeout(guildId(params), userId(params), reason)
        : bot.removeTimeout(guildId(params), userId(params));
}

async function setGuildMemberNickname(bot: DiscordBot, params: Params): Promise<unknown> {
    const args = [
        guildId(params),
        userId(params),
        optionalString(params, "nickname") ?? null,
    ] as const;
    const reason = optionalString(params, "reason");
    return reason ? bot.setMemberNickname(...args, reason) : bot.setMemberNickname(...args);
}

function channelId(params: Params): string {
    return requireSnowflake(params, "channel_id");
}

function guildId(params: Params): string {
    return requireSnowflake(params, "guild_id");
}

function userId(params: Params): string {
    return requireSnowflake(params, "user_id");
}

function messageId(params: Params): string {
    return requireSnowflake(params, "message_id");
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

function invalidParameter(message: string): DiscordError {
    return DiscordError.invalid(message, "DISCORD_ACTION_PARAMS_INVALID");
}
