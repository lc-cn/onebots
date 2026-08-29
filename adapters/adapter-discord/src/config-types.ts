/** 代理配置。 */
export interface ProxyConfig {
    /** 代理服务器地址，如 http://127.0.0.1:7890 */
    url: string;
    username?: string;
    password?: string;
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
    proxy?: ProxyConfig;
    intents?: GatewayIntentName[];
    presence?: {
        status?: PresenceStatus;
        activities?: Array<{
            name: string;
            type?: ActivityType;
            url?: string;
        }>;
    };
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
