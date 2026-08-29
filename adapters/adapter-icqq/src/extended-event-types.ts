import type { ICQQMessageElement } from "./types.js";

/** ICQQ 讨论组消息；使用 namespaced scene ID，避免与 QQ 群号碰撞。 */
export interface ICQQDiscussMessageEvent {
    raw_event: unknown;
    message_id: string;
    discuss_id: number;
    discuss_name: string;
    user_id: number;
    message: ICQQMessageElement[];
    raw_message: string;
    time: number;
    sender: { user_id: number; nickname: string; card?: string };
    atme: boolean;
}

/** QQ 频道消息；ICQQ 的删除推送同样经此结构到达。 */
export interface ICQQGuildMessageEvent {
    raw_event: unknown;
    guild_id: string;
    guild_name: string;
    channel_id: string;
    channel_name: string;
    message_id: string;
    user_id: string;
    message: ICQQMessageElement[];
    raw_message: string;
    time: number;
    is_delete: boolean;
    sender: { user_id: string; nickname: string };
}

export interface ICQQFriendChangeEvent {
    raw_event: unknown;
    change_type: "increase" | "decrease";
    user_id: number;
    nickname: string;
    time: number;
}

export interface ICQQGroupSignEvent {
    raw_event: unknown;
    group_id: number;
    user_id: number;
    nickname: string;
    sign_text: string;
    time: number;
}

export interface ICQQGroupTransferEvent {
    raw_event: unknown;
    group_id: number;
    operator_id: number;
    user_id: number;
    time: number;
}

export interface ICQQReadSyncEvent {
    raw_event: unknown;
    scene_type: "private" | "group";
    scene_id: number;
    /** 私聊为秒级时间游标，群聊为消息 seq。 */
    cursor: number;
    time: number;
}

export interface ICQQTypingEvent {
    raw_event: unknown;
    user_id: number;
    end: boolean;
    time: number;
}
