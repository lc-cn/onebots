/**
 * Satori Protocol Type Declarations
 * Reference: https://github.com/satorijs/satori
 */

export namespace Satori {
    /**
     * Platform types
     */
    export type Platform = string;

    /**
     * Channel types
     */
    export type ChannelType = 0 | 1 | 2 | 3;

    /**
     * User
     */
    export interface User {
        id: string;
        name?: string;
        nick?: string;
        avatar?: string;
        is_bot?: boolean;
    }

    /**
     * Guild (Server/Group)
     */
    export interface Guild {
        id: string;
        name?: string;
        avatar?: string;
    }

    /**
     * Channel
     */
    export interface Channel {
        id: string;
        type: ChannelType;
        name?: string;
        parent_id?: string;
    }

    /**
     * Guild member
     */
    export interface GuildMember {
        user?: User;
        nick?: string;
        avatar?: string;
        joined_at?: number;
    }

    /**
     * Guild role
     */
    export interface GuildRole {
        id: string;
        name?: string;
    }

    /**
     * Message element types
     */
    export type ElementType =
        | "text"
        | "at"
        | "sharp"
        | "a"
        | "img"
        | "audio"
        | "video"
        | "file"
        | "b"
        | "strong"
        | "i"
        | "em"
        | "u"
        | "ins"
        | "s"
        | "del"
        | "spl"
        | "code"
        | "sup"
        | "sub"
        | "br"
        | "p"
        | "message"
        | "quote"
        | "author"
        | "button"
        | "chronocat:face";

    /**
     * Message element
     */
    export interface Element {
        type: ElementType;
        attrs?: Record<string, any>;
        children?: (Element | string)[];
    }

    /**
     * Message
     */
    export interface Message {
        id: string;
        content: string | Element[];
        channel?: Channel;
        guild?: Guild;
        member?: GuildMember;
        user?: User;
        created_at?: number;
        updated_at?: number;
    }

    /**
     * Event types
     */
    export type EventType =
        | "guild-added"
        | "guild-updated"
        | "guild-removed"
        | "guild-request"
        | "guild-member-added"
        | "guild-member-updated"
        | "guild-member-removed"
        | "guild-member-request"
        | "guild-role-created"
        | "guild-role-updated"
        | "guild-role-deleted"
        | "channel-created"
        | "channel-updated"
        | "channel-deleted"
        | "message-created"
        | "message-updated"
        | "message-deleted"
        | "reaction-added"
        | "reaction-removed"
        | "friend-request"
        | "internal";

    /**
     * Login status
     */
    export interface Login {
        user?: User;
        self_id?: string;
        platform?: Platform;
        status: 0 | 1 | 2 | 3;
    }

    /**
     * Event
     */
    export interface Event {
        id: number;
        type: EventType;
        platform: Platform;
        self_id: string;
        timestamp: number;
        argv?: any;
        button?: any;
        channel?: Channel;
        guild?: Guild;
        login?: Login;
        member?: GuildMember;
        message?: Message;
        operator?: User;
        role?: GuildRole;
        user?: User;
    }

    /**
     * Paginated list
     */
    export interface List<T = any> {
        data: T[];
        next?: string;
    }

    /**
     * Bidirectional paginated list
     */
    export interface BidiList<T = any> {
        data: T[];
        prev?: string;
        next?: string;
    }

    /**
     * Direction for message list
     */
    export type Direction = "before" | "after" | "around";

    /**
     * Order for message list
     */
    export type Order = "asc" | "desc";

    /**
     * API Methods
     */
    export interface Methods {
        // Channel methods
        "channel.get"(channel_id: string, guild_id?: string): Promise<Channel>;
        "channel.list"(guild_id: string, next?: string): Promise<List<Channel>>;
        "channel.create"(guild_id: string, data: Partial<Channel>): Promise<Channel>;
        "channel.update"(channel_id: string, data: Partial<Channel>): Promise<void>;
        "channel.delete"(channel_id: string): Promise<void>;

        // Message methods
        "message.create"(channel_id: string, content: string | Element[]): Promise<Message[]>;
        "message.get"(channel_id: string, message_id: string): Promise<Message>;
        "message.delete"(channel_id: string, message_id: string): Promise<void>;
        "message.update"(channel_id: string, message_id: string, content: string | Element[]): Promise<void>;
        "message.list"(
            channel_id: string,
            next?: string,
            direction?: Direction,
            limit?: number,
            order?: Order
        ): Promise<BidiList<Message>>;

        // Guild methods
        "guild.get"(guild_id: string): Promise<Guild>;
        "guild.list"(next?: string): Promise<List<Guild>>;

        // Guild member methods
        "guild.member.get"(guild_id: string, user_id: string): Promise<GuildMember>;
        "guild.member.list"(guild_id: string, next?: string): Promise<List<GuildMember>>;
        "guild.member.kick"(guild_id: string, user_id: string, permanent?: boolean): Promise<void>;
        "guild.member.mute"(guild_id: string, user_id: string, duration: number): Promise<void>;
        "guild.member.role.set"(guild_id: string, user_id: string, role_id: string): Promise<void>;
        "guild.member.role.unset"(guild_id: string, user_id: string, role_id: string): Promise<void>;

        // Guild role methods
        "guild.role.list"(guild_id: string, next?: string): Promise<List<GuildRole>>;
        "guild.role.create"(guild_id: string, data: Partial<GuildRole>): Promise<GuildRole>;
        "guild.role.update"(guild_id: string, role_id: string, data: Partial<GuildRole>): Promise<void>;
        "guild.role.delete"(guild_id: string, role_id: string): Promise<void>;

        // User methods
        "user.get"(user_id: string): Promise<User>;
        "user.channel.create"(user_id: string, guild_id?: string): Promise<Channel>;

        // Friend methods
        "friend.list"(next?: string): Promise<List<User>>;
        "friend.delete"(user_id: string): Promise<void>;

        // Request approval methods
        "friend.approve"(message_id: string, approve: boolean, comment?: string): Promise<void>;
        "guild.approve"(message_id: string, approve: boolean, comment?: string): Promise<void>;
        "guild.member.approve"(message_id: string, approve: boolean, comment?: string): Promise<void>;

        // Reaction methods
        "reaction.create"(channel_id: string, message_id: string, emoji: string): Promise<void>;
        "reaction.delete"(channel_id: string, message_id: string, emoji: string, user_id?: string): Promise<void>;
        "reaction.clear"(channel_id: string, message_id: string, emoji?: string): Promise<void>;
        "reaction.list"(channel_id: string, message_id: string, emoji: string, next?: string): Promise<List<User>>;

        // Login methods
        "login.get"(): Promise<Login>;
    }

    /**
     * API Response
     */
    export interface Response<T = any> {
        data?: T;
        message?: string;
    }
}
