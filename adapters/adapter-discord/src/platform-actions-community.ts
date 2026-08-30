import type { PlatformActionHandler } from "onebots";
import type { DiscordBot } from "./bot.js";
import {
    optionalString,
    query,
    requireObject,
    requireSnowflake,
    type DiscordActionParams,
} from "./platform-action-params.js";

type Handler = PlatformActionHandler<DiscordBot>;

/** Discord Guild 社区治理资源，保持动作名与官方资源边界一一对应。 */
export const DISCORD_COMMUNITY_ACTIONS = {
    list_auto_moderation_rules: restAction(params => autoModerationPath(params)),
    get_auto_moderation_rule: restAction(params =>
        autoModerationPath(params, requireSnowflake(params, "rule_id")),
    ),
    create_auto_moderation_rule: restAction(params => autoModerationPath(params), {
        method: "POST",
        body: "rule",
        audit: true,
    }),
    update_auto_moderation_rule: restAction(
        params => autoModerationPath(params, requireSnowflake(params, "rule_id")),
        { method: "PATCH", body: "rule", audit: true },
    ),
    delete_auto_moderation_rule: restAction(
        params => autoModerationPath(params, requireSnowflake(params, "rule_id")),
        { method: "DELETE", audit: true },
    ),

    list_scheduled_events: restAction(params => scheduledEventPath(params), { query: true }),
    get_scheduled_event: restAction(
        params => scheduledEventPath(params, requireSnowflake(params, "event_id")),
        { query: true },
    ),
    create_scheduled_event: restAction(params => scheduledEventPath(params), {
        method: "POST",
        body: "event",
        audit: true,
    }),
    update_scheduled_event: restAction(
        params => scheduledEventPath(params, requireSnowflake(params, "event_id")),
        { method: "PATCH", body: "event", audit: true },
    ),
    delete_scheduled_event: restAction(
        params => scheduledEventPath(params, requireSnowflake(params, "event_id")),
        { method: "DELETE", audit: true },
    ),
    get_scheduled_event_users: restAction(
        params => `${scheduledEventPath(params, requireSnowflake(params, "event_id"))}/users`,
        { query: true },
    ),

    list_guild_emojis: restAction(params => emojiPath(params)),
    get_guild_emoji: restAction(params => emojiPath(params, requireSnowflake(params, "emoji_id"))),
    create_guild_emoji: restAction(params => emojiPath(params), {
        method: "POST",
        body: "emoji",
        audit: true,
    }),
    update_guild_emoji: restAction(
        params => emojiPath(params, requireSnowflake(params, "emoji_id")),
        { method: "PATCH", body: "emoji", audit: true },
    ),
    delete_guild_emoji: restAction(
        params => emojiPath(params, requireSnowflake(params, "emoji_id")),
        { method: "DELETE", audit: true },
    ),
} satisfies Readonly<Record<string, Handler>>;

interface RestActionOptions {
    method?: "POST" | "PATCH" | "DELETE";
    body?: string;
    query?: boolean;
    audit?: boolean;
}

function restAction(
    path: (params: DiscordActionParams) => string,
    options: RestActionOptions = {},
): Handler {
    return async (bot, params) =>
        bot.getREST().request(path(params), {
            method: options.method,
            body: options.body ? requireObject(params, options.body) : undefined,
            query: options.query ? query(params) : undefined,
            reason: options.audit ? optionalString(params, "reason") : undefined,
        });
}

function autoModerationPath(params: DiscordActionParams, ruleId?: string): string {
    return `/guilds/${requireSnowflake(params, "guild_id")}/auto-moderation/rules${ruleId ? `/${ruleId}` : ""}`;
}

function scheduledEventPath(params: DiscordActionParams, eventId?: string): string {
    return `/guilds/${requireSnowflake(params, "guild_id")}/scheduled-events${eventId ? `/${eventId}` : ""}`;
}

function emojiPath(params: DiscordActionParams, emojiId?: string): string {
    return `/guilds/${requireSnowflake(params, "guild_id")}/emojis${emojiId ? `/${emojiId}` : ""}`;
}
