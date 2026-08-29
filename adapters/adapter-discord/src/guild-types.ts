import type { DiscordApiUser, DiscordEmoji, DiscordStickerItem } from "./message-types.js";

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

export interface DiscordOverwrite {
    id: string;
    type: number;
    allow: string;
    deny: string;
}

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

export interface DiscordRoleTags {
    bot_id?: string;
    integration_id?: string;
    premium_subscriber?: null;
    subscription_listing_id?: string;
    available_for_purchase?: null;
    guild_connections?: null;
}

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

/** Gateway GUILD_DELETE 的最小负载。 */
export interface DiscordGuildDeleteData {
    id: string;
    unavailable?: boolean;
}

/** Gateway GUILD_MEMBER_REMOVE 不包含完整成员字段。 */
export interface DiscordGuildMemberRemoveData {
    guild_id: string;
    user: DiscordApiUser;
}
