import type { DiscordApiGuild, DiscordApiGuildMember } from "./guild-types.js";
import type {
    DiscordApiAttachment,
    DiscordApiMessage,
    DiscordApiUser,
    DiscordEmbed,
    DiscordMessageComponent,
    DiscordMessageReference,
} from "./message-types.js";

export interface DiscordMessageDeleteData {
    id: string;
    channel_id: string;
    guild_id?: string;
}

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

export interface DiscordInteractionDataOption {
    name: string;
    type: number;
    value?: string | number | boolean;
    options?: DiscordInteractionDataOption[];
    focused?: boolean;
}

export interface DiscordInteractionResponse {
    type: number;
    data?: DiscordInteractionCallbackData;
}

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

export interface DiscordInteractionAutocompleteChoice {
    name: string;
    value: string | number;
    name_localizations?: Record<string, string>;
}

export interface GatewayHelloData {
    heartbeat_interval: number;
}

export interface GatewayReadyData {
    v: number;
    user: DiscordApiUser;
    guilds: DiscordApiGuild[];
    session_id: string;
    resume_gateway_url: string;
    shard?: [number, number];
    application: { id: string; flags: number };
}

export interface GatewayQueryOptions {
    limit?: number;
    before?: string;
    after?: string;
    around?: string;
}

export interface GatewayMemberQueryOptions {
    limit?: number;
    after?: string;
}

export interface RESTRequestOptions {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
}

export interface CreateMessageBody {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordMessageComponent[];
    allowed_mentions?: Record<string, unknown>;
    message_reference?: DiscordMessageReference;
    sticker_ids?: string[];
}

export interface EditMessageBody {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordMessageComponent[];
    allowed_mentions?: Record<string, unknown>;
}

export interface CreateChannelBody {
    name: string;
    type?: number;
    topic?: string;
    parent_id?: string;
    nsfw?: boolean;
    position?: number;
}

export interface UpdateChannelBody {
    name?: string;
    topic?: string;
    nsfw?: boolean;
    parent_id?: string;
    position?: number;
}
