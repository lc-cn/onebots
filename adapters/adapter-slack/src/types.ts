/**
 * Slack Bot API 类型定义
 * 基于 Slack Web API
 */

// 配置类型
export interface SlackConfig {
    account_id: string;
    token: string;             // Bot Token (xoxb-...)
    signing_secret?: string;    // Signing Secret（用于验证请求）
    app_token?: string;         // App-Level Token（可选，用于 Socket Mode）
    socket_mode?: boolean;      // 是否使用 Socket Mode
}

// Slack 用户类型
export interface SlackUser {
    id: string;
    name: string;
    real_name?: string;
    display_name?: string;
    profile?: {
        image_24?: string;
        image_32?: string;
        image_48?: string;
        image_72?: string;
        image_192?: string;
        image_512?: string;
        email?: string;
    };
    is_bot?: boolean;
    is_admin?: boolean;
    is_owner?: boolean;
}

// Slack 频道类型
export interface SlackChannel {
    id: string;
    name: string;
    is_channel?: boolean;
    is_group?: boolean;
    is_im?: boolean;
    is_private?: boolean;
    is_archived?: boolean;
    is_member?: boolean;
    topic?: {
        value: string;
        creator: string;
        last_set: number;
    };
    purpose?: {
        value: string;
        creator: string;
        last_set: number;
    };
}

// Slack 消息类型
export interface SlackMessage {
    type: string;
    subtype?: string;
    ts: string;
    user?: string;
    text?: string;
    channel: string;
    files?: Array<{
        id: string;
        name: string;
        url_private: string;
        mimetype?: string;
        size?: number;
    }>;
    attachments?: SlackAttachment[];
    blocks?: SlackBlock[];
    thread_ts?: string;
    reply_count?: number;
    reactions?: Array<{
        name: string;
        users: string[];
        count: number;
    }>;
    [key: string]: unknown;
}

// Slack attachment type
export interface SlackAttachment {
    fallback?: string;
    color?: string;
    image_url?: string;
    text?: string;
    title?: string;
    title_link?: string;
    fields?: Array<{ title: string; value: string; short?: boolean }>;
    [key: string]: unknown;
}

// Slack block type (generic for known block types)
export interface SlackBlock {
    type: string;
    [key: string]: unknown;
}

// Slack 事件类型
export interface SlackEvent {
    type: string;
    subtype?: string;
    event_ts: string;
    user?: string;
    channel?: string;
    text?: string;
    ts?: string;
    [key: string]: unknown;
}

// Slack webhook body type
export interface SlackWebhookBody {
    type?: string;
    challenge?: string;
    token?: string;
    event?: SlackEvent;
    [key: string]: unknown;
}

// Slack message send options
export interface SlackMessageOptions {
    thread_ts?: string;
    mrkdwn?: boolean;
    attachments?: SlackAttachment[];
    blocks?: SlackBlock[];
    unfurl_links?: boolean;
    unfurl_media?: boolean;
    icon_emoji?: string;
    icon_url?: string;
    username?: string;
    [key: string]: unknown;
}

// Slack chat.postMessage result
export interface SlackChatResult {
    ok: boolean;
    channel?: string;
    ts?: string;
    message?: {
        text?: string;
        ts?: string;
        [key: string]: unknown;
    };
    error?: string;
    [key: string]: unknown;
}