import { GatewayIntents } from "./lite/gateway.js";
import { DISCORD_GATEWAY_INTENTS, type GatewayIntentName } from "./types.js";
import { DiscordError } from "./errors.js";

/** 同时满足消息、成员和 Reaction 投影的默认 Gateway 订阅。 */
export const DEFAULT_DISCORD_INTENTS: ReadonlyArray<GatewayIntentName> = [
    "Guilds",
    "GuildMembers",
    "GuildMessages",
    "GuildMessageReactions",
    "DirectMessages",
    "DirectMessageReactions",
    "MessageContent",
];

const intentNames = new Set<string>(DISCORD_GATEWAY_INTENTS);

/** 主适配器与独立 Lite Bot 共用的唯一 Intent 解析入口。 */
export function resolveDiscordIntents(configured?: number | ReadonlyArray<string>): number {
    if (typeof configured === "number") {
        if (!Number.isSafeInteger(configured) || configured < 0) {
            throw DiscordError.invalid(
                "Discord Gateway Intents 位图必须是非负安全整数",
                "DISCORD_INTENTS_INVALID",
            );
        }
        return configured;
    }

    const names = configured?.length ? configured : DEFAULT_DISCORD_INTENTS;
    let bitmask = 0;
    for (const name of names) {
        if (!intentNames.has(name)) {
            throw DiscordError.invalid(
                `未知的 Discord Gateway Intent：${name}`,
                "DISCORD_INTENTS_INVALID",
            );
        }
        bitmask |= GatewayIntents[name as GatewayIntentName];
    }
    return bitmask;
}
