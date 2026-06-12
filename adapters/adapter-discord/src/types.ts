/**
 * Discord 适配器类型定义
 * 基于 Discord API v10，轻量版 - 不依赖 discord.js
 */

// ============================================
// 配置相关类型
// ============================================

/**
 * 代理配置
 */
export interface ProxyConfig {
    /** 代理服务器地址，如 http://127.0.0.1:7890 */
    url: string;
    /** 代理用户名（可选） */
    username?: string;
    /** 代理密码（可选） */
    password?: string;
}

/**
 * Gateway Intents 名称
 */
export type GatewayIntentName =
    | 'Guilds'
    | 'GuildMembers'
    | 'GuildModeration'
    | 'GuildEmojisAndStickers'
    | 'GuildIntegrations'
    | 'GuildWebhooks'
    | 'GuildInvites'
    | 'GuildVoiceStates'
    | 'GuildPresences'
    | 'GuildMessages'
    | 'GuildMessageReactions'
    | 'GuildMessageTyping'
    | 'DirectMessages'
    | 'DirectMessageReactions'
    | 'DirectMessageTyping'
    | 'MessageContent'
    | 'GuildScheduledEvents'
    | 'AutoModerationConfiguration'
    | 'AutoModerationExecution';

/**
 * 在线状态
 */
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

/**
 * 活动类型
 */
export enum ActivityType {
    Playing = 0,
    Streaming = 1,
    Listening = 2,
    Watching = 3,
    Custom = 4,
    Competing = 5,
}

/**
 * Discord 配置类型
 */
export interface DiscordConfig {
    /** 账号标识 */
    account_id: string;
    /** Discord Bot Token */
    token: string;
    /** 代理配置（用于访问 Discord API） */
    proxy?: ProxyConfig;
    /** Gateway Intents - 可选，默认包含常用intents */
    intents?: GatewayIntentName[];
    /** 机器人初始状态 */
    presence?: {
        status?: PresenceStatus;
        activities?: Array<{
            name: string;
            type?: ActivityType;
            url?: string;
        }>;
    };
}

// ============================================
// 枚举类型
// ============================================

/**
 * 频道类型
 */
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

/**
 * 消息类型
 */
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

/**
 * Discord 事件类型
 */
export type DiscordEventType =
    | 'ready'
    | 'messageCreate'
    | 'messageUpdate'
    | 'messageDelete'
    | 'guildMemberAdd'
    | 'guildMemberRemove'
    | 'guildMemberUpdate'
    | 'guildCreate'
    | 'guildDelete'
    | 'channelCreate'
    | 'channelDelete'
    | 'channelUpdate'
    | 'messageReactionAdd'
    | 'messageReactionRemove'
    | 'interactionCreate'
    | 'error';

// ============================================
// Discord API 实体类型 (API v10)
// ============================================

/**
 * Discord 用户 (API User)
 * @see https://discord.com/developers/docs/resources/user#user-object
 */
export interface DiscordApiUser {
    id: string;
    username: string;
    discriminator: string;
    global_name?: string | null;
    avatar: string | null;
    bot?: boolean;
    system?: boolean;
    mfa_enabled?: boolean;
    banner?: string | null;
    accent_color?: number | null;
    locale?: string;
    verified?: boolean;
    email?: string | null;
    flags?: number;
    premium_type?: number;
    public_flags?: number;
    avatar_decoration?: string | null;
}

/**
 * Discord 消息附件
 * @see https://discord.com/developers/docs/resources/message#attachment-object
 */
export interface DiscordApiAttachment {
    id: string;
    filename: string;
    description?: string;
    content_type?: string;
    size: number;
    url: string;
    proxy_url: string;
    height?: number | null;
    width?: number | null;
    ephemeral?: boolean;
}

/**
 * Discord Embed Footer
 */
export interface DiscordEmbedFooter {
    text: string;
    icon_url?: string;
    proxy_icon_url?: string;
}

/**
 * Discord Embed Image
 */
export interface DiscordEmbedImage {
    url?: string;
    proxy_url?: string;
    height?: number;
    width?: number;
}

/**
 * Discord Embed Video
 */
export interface DiscordEmbedVideo {
    url?: string;
    proxy_url?: string;
    height?: number;
    width?: number;
}

/**
 * Discord Embed Provider
 */
export interface DiscordEmbedProvider {
    name?: string;
    url?: string;
}

/**
 * Discord Embed Author
 */
export interface DiscordEmbedAuthor {
    name?: string;
    url?: string;
    icon_url?: string;
    proxy_icon_url?: string;
}

/**
 * Discord Embed Field
 */
export interface DiscordEmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

/**
 * Discord Embed
 * @see https://discord.com/developers/docs/resources/message#embed-object
 */
export interface DiscordEmbed {
    title?: string;
    type?: string;
    description?: string;
    url?: string;
    timestamp?: string;
    color?: number;
    footer?: DiscordEmbedFooter;
    image?: DiscordEmbedImage;
    thumbnail?: DiscordEmbedImage;
    video?: DiscordEmbedVideo;
    provider?: DiscordEmbedProvider;
    author?: DiscordEmbedAuthor;
    fields?: DiscordEmbedField[];
}

/**
 * Discord Reaction
 */
export interface DiscordReaction {
    count: number;
    me: boolean;
    emoji: DiscordEmoji;
}

/**
 * Discord Emoji
 */
export interface DiscordEmoji {
    id: string | null;
    name: string | null;
    roles?: string[];
    user?: DiscordApiUser;
    require_colons?: boolean;
    managed?: boolean;
    animated?: boolean;
    available?: boolean;
}

/**
 * Discord Message Activity
 */
export interface DiscordMessageActivity {
    type: number;
    party_id?: string;
}

/**
 * Discord Message Reference
 */
export interface DiscordMessageReference {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
    fail_if_not_exists?: boolean;
}

/**
 * Discord Message Component (Action Row)
 */
export interface DiscordMessageComponent {
    type: number;
    components?: DiscordMessageComponent[];
    style?: number;
    label?: string;
    emoji?: DiscordEmoji;
    custom_id?: string;
    url?: string;
    disabled?: boolean;
    placeholder?: string;
    min_values?: number;
    max_values?: number;
    options?: DiscordSelectOption[];
}

/**
 * Discord Select Option
 */
export interface DiscordSelectOption {
    label: string;
    value: string;
    description?: string;
    emoji?: DiscordEmoji;
    default?: boolean;
}

/**
 * Discord 消息 (API Message)
 * @see https://discord.com/developers/docs/resources/message#message-object
 */
export interface DiscordApiMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    author: DiscordApiUser;
    content: string;
    timestamp: string;
    edited_timestamp: string | null;
    tts: boolean;
    mention_everyone: boolean;
    mentions: DiscordApiUser[];
    mention_roles: string[];
    mention_channels?: DiscordChannelMention[];
    attachments: DiscordApiAttachment[];
    embeds: DiscordEmbed[];
    reactions?: DiscordReaction[];
    nonce?: string | number;
    pinned: boolean;
    webhook_id?: string;
    type: number;
    activity?: DiscordMessageActivity;
    application?: Record<string, unknown>;
    application_id?: string;
    message_reference?: DiscordMessageReference;
    flags?: number;
    referenced_message?: DiscordApiMessage | null;
    interaction?: Record<string, unknown>;
    thread?: DiscordApiChannel;
    components?: DiscordMessageComponent[];
    sticker_items?: DiscordStickerItem[];
    position?: number;
    role_subscription_data?: Record<string, unknown>;
}

/**
 * Discord Channel Mention
 */
export interface DiscordChannelMention {
    id: string;
    guild_id: string;
    type: number;
    name: string;
}

/**
 * Discord Sticker Item
 */
export interface DiscordStickerItem {
    id: string;
    name: string;
    format_type: number;
}

/**
 * Discord 频道 (API Channel)
 * @see https://discord.com/developers/docs/resources/channel#channel-object
 */
export interface DiscordApiChannel {
    id: string;
    type: number;
    guild_id?: string;
    position?: number;
    permission_overwrites?: DiscordOverwrite[];
    name?: string | null;
    topic?: string | null;
    nsfw?: boolean;
    last_message_id?: string | null;
    bitrate?: number;
    user_limit?: number;
    rate_limit_per_user?: number;
    recipients?: DiscordApiUser[];
    icon?: string | null;
    owner_id?: string;
    application_id?: string;
    managed?: boolean;
    parent_id?: string | null;
    last_pin_timestamp?: string | null;
    rtc_region?: string | null;
    video_quality_mode?: number;
    message_count?: number;
    member_count?: number;
    thread_metadata?: Record<string, unknown>;
    member?: Record<string, unknown>;
    default_auto_archive_duration?: number;
    permissions?: string;
    flags?: number;
    total_message_sent?: number;
}

/**
 * Discord Overwrite
 */
export interface DiscordOverwrite {
    id: string;
    type: number;
    allow: string;
    deny: string;
}

/**
 * Discord 服务器 (API Guild)
 * @see https://discord.com/developers/docs/resources/guild#guild-object
 */
export interface DiscordApiGuild {
    id: string;
    name: string;
    icon: string | null;
    icon_hash?: string | null;
    splash: string | null;
    discovery_splash: string | null;
    owner?: boolean;
    owner_id: string;
    permissions?: string;
    region?: string | null;
    afk_channel_id: string | null;
    afk_timeout: number;
    widget_enabled?: boolean;
    widget_channel_id?: string | null;
    verification_level: number;
    default_message_notifications: number;
    explicit_content_filter: number;
    roles: DiscordRole[];
    emojis: DiscordEmoji[];
    features: string[];
    mfa_level: number;
    application_id: string | null;
    system_channel_id: string | null;
    system_channel_flags: number;
    rules_channel_id: string | null;
    max_presences?: number | null;
    max_members?: number;
    vanity_url_code: string | null;
    description: string | null;
    banner: string | null;
    premium_tier: number;
    premium_subscription_count?: number;
    preferred_locale: string;
    public_updates_channel_id: string | null;
    max_video_channel_users?: number;
    approximate_member_count?: number;
    approximate_presence_count?: number;
    welcome_screen?: Record<string, unknown>;
    nsfw_level: number;
    stickers?: DiscordStickerItem[];
    premium_progress_bar_enabled: boolean;
}

/**
 * Discord 角色 (API Role)
 * @see https://discord.com/developers/docs/topics/permissions#role-object
 */
export interface DiscordRole {
    id: string;
    name: string;
    color: number;
    hoist: boolean;
    icon?: string | null;
    unicode_emoji?: string | null;
    position: number;
    permissions: string;
    managed: boolean;
    mentionable: boolean;
    tags?: DiscordRoleTags;
    flags?: number;
}

/**
 * Discord Role Tags
 */
export interface DiscordRoleTags {
    bot_id?: string;
    integration_id?: string;
    premium_subscriber?: null;
    subscription_listing_id?: string;
    available_for_purchase?: null;
    guild_connections?: null;
}

/**
 * Discord 服务器成员 (API Guild Member)
 * @see https://discord.com/developers/docs/resources/guild#guild-member-object
 */
export interface DiscordApiGuildMember {
    user?: DiscordApiUser;
    nick?: string | null;
    avatar?: string | null;
    roles: string[];
    joined_at: string;
    premium_since?: string | null;
    deaf?: boolean;
    mute?: boolean;
    pending?: boolean;
    permissions?: string;
    communication_disabled_until?: string | null;
}

/**
 * Discord 消息删除事件数据
 */
export interface DiscordMessageDeleteData {
    id: string;
    channel_id: string;
    guild_id?: string;
}

/**
 * Discord Interaction (API)
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
export interface DiscordInteraction {
    id: string;
    application_id: string;
    type: number;
    data?: DiscordInteractionData;
    guild_id?: string;
    channel_id?: string;
    member?: DiscordApiGuildMember;
    user?: DiscordApiUser;
    token: string;
    version: number;
    message?: DiscordApiMessage;
    app_permissions?: string;
    locale?: string;
    guild_locale?: string;
}

/**
 * Discord Interaction Data
 */
export interface DiscordInteractionData {
    id?: string;
    name?: string;
    type?: number;
    resolved?: Record<string, unknown>;
    options?: DiscordInteractionDataOption[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
    target_id?: string;
    components?: DiscordMessageComponent[];
}

/**
 * Discord Interaction Data Option
 */
export interface DiscordInteractionDataOption {
    name: string;
    type: number;
    value?: string | number | boolean;
    options?: DiscordInteractionDataOption[];
    focused?: boolean;
}

/**
 * Discord Interaction Response
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object
 */
export interface DiscordInteractionResponse {
    type: number;
    data?: DiscordInteractionCallbackData;
}

/**
 * Discord Interaction Callback Data
 */
export interface DiscordInteractionCallbackData {
    tts?: boolean;
    content?: string;
    embeds?: DiscordEmbed[];
    allowed_mentions?: Record<string, unknown>;
    flags?: number;
    components?: DiscordMessageComponent[];
    attachments?: Partial<DiscordApiAttachment>[];
    choices?: DiscordInteractionAutocompleteChoice[];
    custom_id?: string;
    title?: string;
}

/**
 * Discord Interaction Autocomplete Choice
 */
export interface DiscordInteractionAutocompleteChoice {
    name: string;
    value: string | number;
    name_localizations?: Record<string, string>;
}

/**
 * Discord Gateway Hello 事件数据
 */
export interface GatewayHelloData {
    heartbeat_interval: number;
}

/**
 * Discord Gateway Ready 事件数据
 */
export interface GatewayReadyData {
    v: number;
    user: DiscordApiUser;
    guilds: DiscordApiGuild[];
    session_id: string;
    resume_gateway_url: string;
    shard?: [number, number];
    application: { id: string; flags: number };
}

/**
 * Gateway 请求查询参数
 */
export interface GatewayQueryOptions {
    limit?: number;
    before?: string;
    after?: string;
    around?: string;
}

/**
 * Gateway 成员查询参数
 */
export interface GatewayMemberQueryOptions {
    limit?: number;
    after?: string;
}

/**
 * REST API 请求选项
 */
export interface RESTRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
}

/**
 * 发送消息请求体
 */
export interface CreateMessageBody {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordMessageComponent[];
    allowed_mentions?: Record<string, unknown>;
    message_reference?: DiscordMessageReference;
    sticker_ids?: string[];
}

/**
 * 编辑消息请求体
 */
export interface EditMessageBody {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordMessageComponent[];
    allowed_mentions?: Record<string, unknown>;
}

/**
 * 创建频道请求体
 */
export interface CreateChannelBody {
    name: string;
    type?: number;
    topic?: string;
    parent_id?: string;
    nsfw?: boolean;
    position?: number;
}

/**
 * 更新频道请求体
 */
export interface UpdateChannelBody {
    name?: string;
    topic?: string;
    nsfw?: boolean;
    parent_id?: string;
    position?: number;
}
