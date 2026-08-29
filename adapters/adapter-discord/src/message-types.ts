import type { DiscordApiChannel } from "./guild-types.js";

/** Discord API v10 User。 */
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

export interface DiscordEmbedFooter {
    text: string;
    icon_url?: string;
    proxy_icon_url?: string;
}

export interface DiscordEmbedImage {
    url?: string;
    proxy_url?: string;
    height?: number;
    width?: number;
}

export interface DiscordEmbedVideo extends DiscordEmbedImage {}

export interface DiscordEmbedProvider {
    name?: string;
    url?: string;
}

export interface DiscordEmbedAuthor {
    name?: string;
    url?: string;
    icon_url?: string;
    proxy_icon_url?: string;
}

export interface DiscordEmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

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

export interface DiscordReaction {
    count: number;
    me: boolean;
    emoji: DiscordEmoji;
}

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

export interface DiscordMessageActivity {
    type: number;
    party_id?: string;
}

export interface DiscordMessageReference {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
    fail_if_not_exists?: boolean;
}

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

export interface DiscordSelectOption {
    label: string;
    value: string;
    description?: string;
    emoji?: DiscordEmoji;
    default?: boolean;
}

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

/** Gateway MESSAGE_UPDATE 仅保证消息与频道 ID，其余字段按实际变化出现。 */
export type DiscordMessageUpdateData = Pick<DiscordApiMessage, "id" | "channel_id"> &
    Partial<Omit<DiscordApiMessage, "id" | "channel_id">>;

export interface DiscordChannelMention {
    id: string;
    guild_id: string;
    type: number;
    name: string;
}

export interface DiscordStickerItem {
    id: string;
    name: string;
    format_type: number;
}
