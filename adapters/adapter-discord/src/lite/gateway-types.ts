import type {
    DiscordApiGuild,
    DiscordApiGuildMember,
    DiscordApiMessage,
    DiscordApiUser,
    DiscordInteraction,
    DiscordMessageDeleteData,
    DiscordMessageUpdateData,
    DiscordGuildDeleteData,
    DiscordGuildMemberRemoveData,
} from "../types.js";
import type { DiscordError } from "../errors.js";
import type { DiscordREST } from "./rest.js";

/** Discord Gateway v10 操作码。 */
export enum GatewayOpcodes {
    Dispatch = 0,
    Heartbeat = 1,
    Identify = 2,
    PresenceUpdate = 3,
    VoiceStateUpdate = 4,
    Resume = 6,
    Reconnect = 7,
    RequestGuildMembers = 8,
    InvalidSession = 9,
    Hello = 10,
    HeartbeatAck = 11,
    RequestSoundboardSounds = 31,
    RequestChannelInfo = 43,
}

/** Discord Gateway v10 intents 位标记。 */
export enum GatewayIntents {
    Guilds = 1 << 0,
    GuildMembers = 1 << 1,
    GuildModeration = 1 << 2,
    GuildEmojisAndStickers = 1 << 3,
    GuildIntegrations = 1 << 4,
    GuildWebhooks = 1 << 5,
    GuildInvites = 1 << 6,
    GuildVoiceStates = 1 << 7,
    GuildPresences = 1 << 8,
    GuildMessages = 1 << 9,
    GuildMessageReactions = 1 << 10,
    GuildMessageTyping = 1 << 11,
    DirectMessages = 1 << 12,
    DirectMessageReactions = 1 << 13,
    DirectMessageTyping = 1 << 14,
    MessageContent = 1 << 15,
    GuildScheduledEvents = 1 << 16,
    AutoModerationConfiguration = 1 << 20,
    AutoModerationExecution = 1 << 21,
    GuildMessagePolls = 1 << 24,
    DirectMessagePolls = 1 << 25,
}

export interface GatewayOptions {
    token: string;
    intents: number;
    /** 复用已经配置好基址、传输和限流状态的 REST 客户端。 */
    rest?: DiscordREST;
    proxy?: { url: string; username?: string; password?: string };
    presence?: {
        since?: number | null;
        activities: Array<{ name: string; type: number; url?: string; state?: string }>;
        status: "online" | "idle" | "dnd" | "invisible";
        afk?: boolean;
    };
    /** 当前分片编号与分片总数。 */
    shard?: readonly [number, number];
}

export interface DiscordGatewayEvents {
    ready: [user: DiscordApiUser];
    resumed: [];
    connected: [];
    reconnecting: [error: DiscordError];
    client_error: [error: DiscordError];
    close: [code: number, reason: string];
    dispatch: [eventName: string, data: unknown, sequence: number | null, sessionId: string | null];
    messageCreate: [message: DiscordApiMessage];
    messageUpdate: [message: DiscordMessageUpdateData];
    messageDelete: [data: DiscordMessageDeleteData];
    guildCreate: [guild: DiscordApiGuild];
    guildDelete: [guild: DiscordGuildDeleteData];
    guildMemberAdd: [member: DiscordApiGuildMember];
    guildMemberRemove: [member: DiscordGuildMemberRemoveData];
    interactionCreate: [interaction: DiscordInteraction];
}

export interface GatewayPayload {
    op: number;
    d: unknown;
    s: number | null;
    t: string | null;
}

export interface WsWebSocket {
    readyState: number;
    send(data: string): void;
    close(): void;
    removeAllListeners(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
}

const FATAL_GATEWAY_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

/** 不允许自动重试的 Discord Gateway close code。 */
export function isFatalGatewayCloseCode(code: number): boolean {
    return FATAL_GATEWAY_CLOSE_CODES.has(code);
}
