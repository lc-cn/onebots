/**
 * Zulip 适配器类型定义
 * 基于 Zulip REST API 和 WebSocket API
 */

/**
 * 代理配置
 */
export interface ProxyConfig {
    /** 代理服务器地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
    url: string;
    /** 代理用户名（可选） */
    username?: string;
    /** 代理密码（可选） */
    password?: string;
}

/**
 * Zulip 配置
 */
export interface ZulipConfig {
    account_id: string;
    /** Zulip 服务器地址，如 https://chat.zulip.org */
    serverUrl: string;
    /** 邮箱地址 */
    email: string;
    /** API Key */
    apiKey: string;
    /** 代理配置（可选） */
    proxy?: ProxyConfig;
    /** WebSocket 配置 */
    websocket?: {
        /** 是否启用 WebSocket，默认 true */
        enabled?: boolean;
        /** 重连间隔（毫秒），默认 3000 */
        reconnectInterval?: number;
        /** 最大重连次数，默认 10 */
        maxReconnectAttempts?: number;
    };
}

/**
 * Zulip 消息类型
 */
export type ZulipMessageType = 
    | 'stream'
    | 'private';

/**
 * Zulip 事件类型
 */
export type ZulipEventType =
    | 'message'
    | 'update_message'
    | 'delete_message'
    | 'reaction'
    | 'typing'
    | 'presence'
    | 'user_status'
    | 'subscription'
    | 'realm_user'
    | 'heartbeat';

/**
 * Zulip 消息事件
 */
export interface ZulipMessageEvent {
    /** 事件类型 */
    type: 'message';
    /** 消息 ID */
    id: number;
    /** 消息类型：stream 或 private */
    message_type: ZulipMessageType;
    /** 发送者信息 */
    sender_id: number;
    sender_email: string;
    sender_full_name: string;
    sender_realm_str: string;
    /** 消息内容 */
    content: string;
    /** 主题（stream 消息） */
    subject?: string;
    /** 流名称（stream 消息） */
    stream_name?: string;
    /** 流 ID（stream 消息） */
    stream_id?: number;
    /** 话题（stream 消息） */
    topic?: string;
    /** 收件人列表（private 消息） */
    display_recipient?: Array<{
        id: number;
        email: string;
        full_name: string;
    }>;
    /** 时间戳 */
    timestamp: number;
    /** 客户端 */
    client: string;
    /** 消息标志 */
    flags: string[];
    /** 反应 */
    reactions?: Array<{
        emoji_name: string;
        emoji_code: string;
        reaction_type: string;
        user_id: number;
    }>;
    /** 附件 */
    attachments?: Array<{
        id: number;
        name: string;
        size: number;
        path: string;
        create_time: number;
        messages: number[];
    }>;
    /** 提及的用户 ID */
    mentioned_user_ids?: number[];
    /** 子消息 */
    submessages?: ZulipSubmessage[];
}

/**
 * Zulip 子消息
 */
export interface ZulipSubmessage {
    msg_type: string;
    content: string;
    sender_id: number;
    message_id: number;
    id: number;
}

/**
 * Zulip 获取流列表响应
 */
export interface ZulipStreamsResponse {
    streams: ZulipStream[];
}

/**
 * Zulip 获取用户信息响应
 */
export interface ZulipUserResponse {
    result: string;
    msg: string;
    user: ZulipUser;
}

/**
 * Zulip 更新消息事件
 */
export interface ZulipUpdateMessageEvent {
    type: 'update_message';
    message_id: number;
    user_id: number;
    edit_timestamp: number;
    stream_id?: number;
    topic?: string;
    propagated_topic?: string;
    orig_topic?: string;
    content?: string;
    rendered_content?: string;
    prev_rendered_content_version?: number;
    rendered_content_version?: number;
    is_me_message?: boolean;
}

/**
 * Zulip 删除消息事件
 */
export interface ZulipDeleteMessageEvent {
    type: 'delete_message';
    message_id: number;
}

/**
 * Zulip 反应事件
 */
export interface ZulipReactionEvent {
    type: 'reaction';
    message_id: number;
    emoji_name: string;
    emoji_code: string;
    reaction_type: string;
    user_id: number;
    user: {
        email: string;
        full_name: string;
        user_id: number;
    };
}

/**
 * Zulip 心跳事件
 */
export interface ZulipHeartbeatEvent {
    type: 'heartbeat';
}

/**
 * Zulip WebSocket 事件
 */
export type ZulipWebSocketEvent =
    | ZulipMessageEvent
    | ZulipUpdateMessageEvent
    | ZulipDeleteMessageEvent
    | ZulipReactionEvent
    | ZulipHeartbeatEvent;

/**
 * Zulip 发送消息参数
 */
export interface ZulipSendMessageParams {
    /** 消息类型：stream 或 private */
    type: ZulipMessageType;
    /** 流名称（stream 消息） */
    to?: string;
    /** 话题（stream 消息） */
    topic?: string;
    /** 收件人邮箱列表（private 消息） */
    to_emails?: string[];
    /** 消息内容 */
    content: string;
    /** 客户端名称 */
    client?: string;
}

/**
 * Zulip API 响应
 */
export interface ZulipAPIResponse {
    result: string;
    msg?: string;
    id?: number;
    message_id?: number;
}

/**
 * Zulip 流信息
 */
export interface ZulipStream {
    stream_id: number;
    name: string;
    description: string;
    date_created: number;
    invite_only: boolean;
    is_web_public: boolean;
    stream_post_policy: number;
    message_retention_days: number | null;
    history_public_to_subscribers: boolean;
    first_message_id: number | null;
    is_announcement_only: boolean;
    stream_weekly_traffic: number | null;
}

/**
 * Zulip 用户信息
 */
export interface ZulipUser {
    user_id: number;
    email: string;
    full_name: string;
    avatar_url: string;
    is_admin: boolean;
    is_owner: boolean;
    is_guest: boolean;
    is_bot: boolean;
    role: number;
    timezone: string;
    date_joined: string;
    is_active: boolean;
}

