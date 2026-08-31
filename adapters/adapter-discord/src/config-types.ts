import { DiscordError } from "./errors.js";

/** 代理配置。 */
export interface ProxyConfig {
    /** 代理服务器地址，如 http://127.0.0.1:7890 */
    url: string;
    username?: string;
    password?: string;
}

/** 验证 REST 与 Gateway 共用的代理边界。 */
export function assertDiscordProxyConfig(proxy?: ProxyConfig): void {
    if (!proxy) return;
    try {
        const url = new URL(proxy.url);
        if (
            !["http:", "https:", "socks:", "socks4:", "socks5:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            throw DiscordError.configuration(
                "Discord 代理地址必须使用 HTTP(S) 或 SOCKS，凭据请使用独立字段",
                "DISCORD_PROXY_URL_INVALID",
            );
        }
    } catch (error) {
        if (error instanceof DiscordError) throw error;
        throw DiscordError.configuration(
            "Discord 代理地址不是有效 URL",
            "DISCORD_PROXY_URL_INVALID",
        );
    }
}

/** Discord Gateway v10 支持的 Intent 名称。 */
export const DISCORD_GATEWAY_INTENTS = [
    "Guilds",
    "GuildMembers",
    "GuildModeration",
    "GuildEmojisAndStickers",
    "GuildIntegrations",
    "GuildWebhooks",
    "GuildInvites",
    "GuildVoiceStates",
    "GuildPresences",
    "GuildMessages",
    "GuildMessageReactions",
    "GuildMessageTyping",
    "DirectMessages",
    "DirectMessageReactions",
    "DirectMessageTyping",
    "MessageContent",
    "GuildScheduledEvents",
    "AutoModerationConfiguration",
    "AutoModerationExecution",
    "GuildMessagePolls",
    "DirectMessagePolls",
] as const;

export type GatewayIntentName = (typeof DISCORD_GATEWAY_INTENTS)[number];
export type PresenceStatus = "online" | "idle" | "dnd" | "invisible";

export enum ActivityType {
    Playing = 0,
    Streaming = 1,
    Listening = 2,
    Watching = 3,
    Custom = 4,
    Competing = 5,
}

export interface DiscordConfig {
    account_id: string;
    token: string;
    receive_mode?: "gateway" | "interactions" | "webhook_events" | "manual";
    /** Discord Application ID；HTTP 接收模式必填。 */
    application_id?: string;
    /** Discord Application Public Key；HTTP 接收模式必填。 */
    public_key?: string;
    proxy?: ProxyConfig;
    intents?: GatewayIntentName[];
    shard?: {
        /** 从 0 开始的当前分片编号。 */
        id: number;
        /** 该 Bot 使用的分片总数。 */
        total: number;
    };
    presence?: {
        status?: PresenceStatus;
        since?: number;
        afk?: boolean;
        activities?: Array<{
            name: string;
            type?: ActivityType;
            url?: string;
            state?: string;
        }>;
    };
}

/** 将用户分片配置验证并转换为 Gateway Identify 元组。 */
export function resolveDiscordShard(
    shard: DiscordConfig["shard"],
): readonly [number, number] | undefined {
    if (!shard) return undefined;
    if (
        !Number.isSafeInteger(shard.id) ||
        !Number.isSafeInteger(shard.total) ||
        shard.id < 0 ||
        shard.total < 1 ||
        shard.id >= shard.total
    ) {
        throw DiscordError.configuration(
            "Discord shard.id 必须从 0 开始且小于 shard.total",
            "DISCORD_SHARD_INVALID",
        );
    }
    return [shard.id, shard.total];
}

export enum ChannelType {
    GuildText = 0,
    DM = 1,
    GuildVoice = 2,
    GroupDM = 3,
    GuildCategory = 4,
    GuildAnnouncement = 5,
    AnnouncementThread = 10,
    PublicThread = 11,
    PrivateThread = 12,
    GuildStageVoice = 13,
    GuildDirectory = 14,
    GuildForum = 15,
    GuildMedia = 16,
}

export enum MessageType {
    Default = 0,
    RecipientAdd = 1,
    RecipientRemove = 2,
    Call = 3,
    ChannelNameChange = 4,
    ChannelIconChange = 5,
    ChannelPinnedMessage = 6,
    UserJoin = 7,
    GuildBoost = 8,
    GuildBoostTier1 = 9,
    GuildBoostTier2 = 10,
    GuildBoostTier3 = 11,
    ChannelFollowAdd = 12,
    GuildDiscoveryDisqualified = 14,
    GuildDiscoveryRequalified = 15,
    ThreadCreated = 18,
    Reply = 19,
    ChatInputCommand = 20,
    ThreadStarterMessage = 21,
    GuildInviteReminder = 22,
    ContextMenuCommand = 23,
    AutoModerationAction = 24,
}

export type DiscordEventType =
    | "ready"
    | "messageCreate"
    | "messageUpdate"
    | "messageDelete"
    | "guildMemberAdd"
    | "guildMemberRemove"
    | "guildMemberUpdate"
    | "guildCreate"
    | "guildDelete"
    | "channelCreate"
    | "channelDelete"
    | "channelUpdate"
    | "messageReactionAdd"
    | "messageReactionRemove"
    | "interactionCreate"
    | "error";
