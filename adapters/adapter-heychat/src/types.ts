/**
 * 黑盒语音 (Heychat) 类型定义
 */

export interface ProxyConfig {
    url: string;
    username?: string;
    password?: string;
}

export interface HeychatConfig {
    account_id: string;
    token: string;
    api_base?: string;
    upload_base?: string;
    ws_url?: string;
    chat_version?: string;
    ping_interval?: number;
    ignore_self_messages?: boolean;
    proxy?: ProxyConfig;
}

export interface HeychatRoomBaseInfo {
    room_id: string;
    room_name?: string;
    room_avatar?: string;
}

export interface HeychatChannelBaseInfo {
    channel_id: string;
    channel_name?: string;
    channel_type?: number;
}

export interface HeychatSenderInfo {
    user_id: number;
    nickname?: string;
    avatar?: string;
    bot?: boolean;
    level?: number;
    room_nickname?: string;
}

export interface HeychatCommandOption {
    name: string;
    type: number;
    value?: string;
    choices?: HeychatCommandOption[];
}

export interface HeychatCommandInfo {
    id: string;
    name: string;
    type?: number;
    options?: HeychatCommandOption[];
}

export interface HeychatWsEnvelope {
    sequence: number;
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
    notify_type?: string;
}

export interface HeychatUseCommandData {
    bot_id?: number;
    room_base_info?: HeychatRoomBaseInfo;
    channel_base_info?: HeychatChannelBaseInfo;
    command_info?: HeychatCommandInfo;
    msg_id?: string;
    send_time?: number;
    sender_info?: HeychatSenderInfo;
}

export interface HeychatChannelMessageData {
    bot_id?: number;
    room_base_info?: HeychatRoomBaseInfo;
    channel_base_info?: HeychatChannelBaseInfo;
    sender_info?: HeychatSenderInfo;
    msg_id?: string;
    send_time?: number;
    msg?: string;
    content?: string;
    text?: string;
}

/** Bot 内部统一消息事件 */
export interface HeychatMessageEvent {
    source: 'command' | 'channel';
    bot_id?: number;
    room_id: string;
    room_name?: string;
    channel_id: string;
    channel_name?: string;
    channel_type?: number;
    msg_id: string;
    send_time: number;
    user_id: number;
    nickname: string;
    avatar?: string;
    raw_message: string;
    command_id?: string;
    command_name?: string;
}

export interface HeychatChannelContext {
    room_id: string;
    channel_id: string;
    channel_type?: number;
    room_name?: string;
    channel_name?: string;
}

export interface HeychatSendMessageOptions {
    reply_id?: string;
    msg_type?: number;
    at_user_id?: string;
}

export interface HeychatSendMessageResult {
    msg_id: string;
    heychat_ack_id: string;
}

export interface HeychatRoomInfo {
    room_id: string;
    room_name?: string;
    room_avatar?: string;
    member_count?: number;
}

export interface HeychatApiResponse<T = unknown> {
    status?: string;
    msg?: string;
    message?: string;
    result?: T;
    data?: T;
}
