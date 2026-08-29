import { GatewayIntents } from "./lite/gateway.js";
import { DISCORD_GATEWAY_INTENTS, type GatewayIntentName } from "./types.js";

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
            throw new Error("Discord Gateway Intents 位图必须是非负安全整数");
        }
        return configured;
    }

    const names = configured?.length ? configured : DEFAULT_DISCORD_INTENTS;
    let bitmask = 0;
    for (const name of names) {
        if (!intentNames.has(name)) throw new Error(`未知的 Discord Gateway Intent：${name}`);
        bitmask |= GatewayIntents[name as GatewayIntentName];
    }
    return bitmask;
}
