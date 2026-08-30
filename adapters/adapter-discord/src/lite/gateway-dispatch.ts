import type { EventEmitter } from "node:events";
import { emitAllAwaited } from "onebots";
import type {
    DiscordApiGuild,
    DiscordApiGuildMember,
    DiscordApiMessage,
    DiscordGuildDeleteData,
    DiscordGuildMemberRemoveData,
    DiscordInteraction,
    DiscordMessageDeleteData,
    DiscordMessageUpdateData,
} from "../types.js";

/** 将无状态的 Discord Dispatch 映射为具名便捷事件；会话事件由 Gateway 自身处理。 */
export async function emitDiscordGatewayEvent(
    target: Pick<EventEmitter, "rawListeners">,
    eventName: string,
    data: unknown,
): Promise<void> {
    switch (eventName) {
        case "MESSAGE_CREATE":
            await emitAllAwaited(target, "messageCreate", data as DiscordApiMessage);
            break;
        case "MESSAGE_UPDATE":
            await emitAllAwaited(target, "messageUpdate", data as DiscordMessageUpdateData);
            break;
        case "MESSAGE_DELETE":
            await emitAllAwaited(target, "messageDelete", data as DiscordMessageDeleteData);
            break;
        case "GUILD_CREATE":
            await emitAllAwaited(target, "guildCreate", data as DiscordApiGuild);
            break;
        case "GUILD_DELETE":
            await emitAllAwaited(target, "guildDelete", data as DiscordGuildDeleteData);
            break;
        case "GUILD_MEMBER_ADD":
            await emitAllAwaited(target, "guildMemberAdd", data as DiscordApiGuildMember);
            break;
        case "GUILD_MEMBER_REMOVE":
            await emitAllAwaited(target, "guildMemberRemove", data as DiscordGuildMemberRemoveData);
            break;
        case "INTERACTION_CREATE":
            await emitAllAwaited(target, "interactionCreate", data as DiscordInteraction);
            break;
        default:
            // 原始 dispatch 由 Gateway 在进入此投影前统一发出。
            break;
    }
}
