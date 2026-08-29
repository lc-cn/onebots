import { DiscordLite, InteractionsHandler, type DiscordLiteOptions } from "./lite/index.js";
import type { DiscordConfig } from "./types.js";
import { resolveDiscordIntents } from "./intents.js";
import { resolveDiscordShard } from "./config-types.js";
import { DiscordError } from "./errors.js";

/** 将 OneBots 账号配置收敛为唯一的 DiscordLite 构造边界。 */
export function createDiscordLite(config: DiscordConfig): DiscordLite {
    const options: DiscordLiteOptions = {
        token: config.token,
        intents: resolveDiscordIntents(config.intents),
        proxy: config.proxy,
        mode: config.receive_mode ?? "gateway",
        publicKey: config.public_key,
        applicationId: config.application_id,
        // 网关协议消费者异步处理事件，因此先在 Discord 的 3 秒窗口内确认接收。
        unhandledInteractionHandler: interaction => InteractionsHandler.deferUnhandled(interaction),
        shard: resolveDiscordShard(config.shard),
        presence: resolvePresence(config.presence),
    };
    return new DiscordLite(options);
}

function resolvePresence(config: DiscordConfig["presence"]): DiscordLiteOptions["presence"] {
    if (!config) return undefined;
    const status = config.status ?? "online";
    if (!new Set(["online", "idle", "dnd", "invisible"]).has(status)) {
        throw DiscordError.configuration(
            "Discord presence.status 无效",
            "DISCORD_PRESENCE_INVALID",
        );
    }
    if (config.since !== undefined && (!Number.isSafeInteger(config.since) || config.since < 0)) {
        throw DiscordError.configuration(
            "Discord presence.since 必须为非负整数毫秒时间戳",
            "DISCORD_PRESENCE_INVALID",
        );
    }
    const activities = (config.activities ?? []).map(activity => {
        if (!activity.name?.trim() || !Number.isInteger(activity.type ?? 0)) {
            throw DiscordError.configuration(
                "Discord Presence 活动必须提供名称与有效类型",
                "DISCORD_PRESENCE_INVALID",
            );
        }
        const type = activity.type ?? 0;
        if (type < 0 || type > 5) {
            throw DiscordError.configuration(
                "Discord Presence 活动类型必须在 0-5 之间",
                "DISCORD_PRESENCE_INVALID",
            );
        }
        return { ...activity, type };
    });
    return { since: config.since ?? null, activities, status, afk: config.afk ?? false };
}
