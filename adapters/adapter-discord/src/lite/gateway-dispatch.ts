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
import type { DiscordGatewayEvents } from "./gateway-types.js";

interface DiscordGatewayEventEmitter {
    emit<K extends keyof DiscordGatewayEvents>(event: K, ...args: DiscordGatewayEvents[K]): boolean;
}

/** 将无状态的 Discord Dispatch 映射为具名便捷事件；会话事件由 Gateway 自身处理。 */
export function emitDiscordGatewayEvent(
    target: DiscordGatewayEventEmitter,
    eventName: string,
    data: unknown,
): void {
    switch (eventName) {
        case "MESSAGE_CREATE":
            target.emit("messageCreate", data as DiscordApiMessage);
            break;
        case "MESSAGE_UPDATE":
            target.emit("messageUpdate", data as DiscordMessageUpdateData);
            break;
        case "MESSAGE_DELETE":
            target.emit("messageDelete", data as DiscordMessageDeleteData);
            break;
        case "GUILD_CREATE":
            target.emit("guildCreate", data as DiscordApiGuild);
            break;
        case "GUILD_DELETE":
            target.emit("guildDelete", data as DiscordGuildDeleteData);
            break;
        case "GUILD_MEMBER_ADD":
            target.emit("guildMemberAdd", data as DiscordApiGuildMember);
            break;
        case "GUILD_MEMBER_REMOVE":
            target.emit("guildMemberRemove", data as DiscordGuildMemberRemoveData);
            break;
        case "INTERACTION_CREATE":
            target.emit("interactionCreate", data as DiscordInteraction);
            break;
        default:
            // 原始 dispatch 由 Gateway 在进入此投影前统一发出。
            break;
    }
}
