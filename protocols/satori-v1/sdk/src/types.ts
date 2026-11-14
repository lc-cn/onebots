/**
 * Satori V1 Client Types
 *
 * 字段名与资源形状以 https://satori.chat 当前文档为准。
 */

import type { Adapter, GroupMember } from "imhelper";

/** https://satori.chat/zh-CN/resources/user.html */
export interface SatoriUser {
    id: string;
    name?: string;
    nick?: string;
    avatar?: string;
    is_bot?: boolean;
}

/** https://satori.chat/zh-CN/resources/role.html */
export interface SatoriGuildRole {
    id: string;
    name?: string;
}

/** https://satori.chat/zh-CN/resources/member.html */
export interface SatoriGuildMember {
    user?: SatoriUser;
    nick?: string;
    avatar?: string;
    joined_at?: number;
    roles?: SatoriGuildRole[];
}

/** 目录投影保留 imhelper 成员字段，并按协议暴露 GuildRole[]。 */
export interface SatoriMemberData extends GroupMember.Data<string> {
    roles?: SatoriGuildRole[];
}

/** https://satori.chat/zh-CN/resources/friend.html */
export interface SatoriFriend {
    user?: SatoriUser;
    nick?: string;
}

/** https://satori.chat/zh-CN/resources/emoji.html */
export interface SatoriEmoji {
    id: string;
    name?: string;
}

/** https://satori.chat/zh-CN/protocol/api.html 分页列表。 */
export interface SatoriList<T> {
    data: T[];
    next?: string;
}

export interface SatoriV1Event {
    id: string;
    type: string;
    platform: string;
    timestamp: number;
    channel?: { id: string; [key: string]: unknown };
    guild?: { id: string; [key: string]: unknown };
    user?: SatoriUser & { [key: string]: unknown };
    operator?: { id: string; [key: string]: unknown };
    login?: {
        user?: { id: string; [key: string]: unknown };
        status: number;
        [key: string]: unknown;
    };
    message?: {
        id: string;
        content?: string | SatoriElement[];
        created_at?: number;
        [key: string]: unknown;
    };
    /** https://satori.chat/zh-CN/resources/emoji.html */
    emoji?: SatoriEmoji;
    /** https://satori.chat/zh-CN/resources/friend.html */
    friend?: SatoriFriend;
    /** https://satori.chat/zh-CN/resources/member.html */
    member?: SatoriGuildMember;
    /** https://satori.chat/zh-CN/resources/role.html */
    role?: SatoriGuildRole;
    /**
     * 被动请求来源。结构由平台适配器决定，回复时必须原样传入 message.create。
     * https://satori.chat/zh-CN/advanced/passive.html
     * https://satori.chat/zh-CN/protocol/events.html
     */
    referrer?: object;
    [key: string]: unknown;
}

export interface SatoriElement {
    type: string;
    attrs?: Record<string, unknown>;
    children?: Array<SatoriElement | string>;
}

export interface SatoriEmojiAttrs {
    id?: string;
    name?: string;
}

export type SatoriGatewayPayload =
    | { op: 0; body: SatoriV1Event }
    | { op: 2; body?: unknown }
    | { op: 4; body: { logins: Array<Record<string, unknown>> } };

export type SatoriCall = (
    resource: string,
    method: string,
    params?: Record<string, unknown>,
) => Promise<unknown>;

export type SatoriActionUrlResolver = (
    resource: string,
    method: string,
    apiBaseUrl: string,
) => string | URL;

/** 发送参数。referrer 会原样写入 /message.create。 */
export interface SatoriSendMessageOptions extends Adapter.SendMessageOptions<string> {
    referrer?: object;
}

/** 回复参数。未显式传入 referrer 时，使用来源消息事件上的 referrer。 */
export interface SatoriReplyMessageOptions extends Adapter.ReplyMessageOptions<string> {
    referrer?: object;
}

/** Satori 适配器在通用 Adapter 之外暴露的 1.3 资源入口。 */
export interface SatoriAdapter extends Adapter<string, SatoriV1Event> {
    sendMessage(options: SatoriSendMessageOptions): Promise<unknown>;
    replyMessage(options: SatoriReplyMessageOptions): Promise<unknown>;
    call<T = unknown>(
        resource: string,
        method: string,
        params?: Record<string, unknown>,
    ): Promise<T>;
    listFriends(): Promise<SatoriFriend[]>;
    getGroupMemberInfo(groupId: string, userId: string): Promise<SatoriMemberData>;
    getGroupMemberList(groupId: string): Promise<SatoriMemberData[]>;
    deleteReaction(
        channelId: string,
        messageId: string,
        emojiId: string,
        userId?: string,
    ): Promise<void>;
    clearReaction(channelId: string, messageId: string, emojiId?: string): Promise<void>;
    listReactions(
        channelId: string,
        messageId: string,
        emojiId: string,
        next?: string,
    ): Promise<SatoriList<SatoriUser>>;
}
