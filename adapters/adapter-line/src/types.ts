/**
 * Line Messaging API 类型定义
 * 基于 Line Messaging API 官方文档
 * https://developers.line.biz/en/docs/messaging-api/
 */

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
 * Line 配置
 */
export interface LineConfig {
    /** 账号标识 */
    account_id: string;
    /** Channel Access Token */
    channel_access_token: string;
    /** Channel Secret（用于验证 Webhook 签名） */
    channel_secret: string;
    /** 代理配置 */
    proxy?: ProxyConfig;
}

// ============================================
// Webhook 事件类型
// ============================================

/**
 * Webhook 事件基础类型
 */
export interface WebhookEvent {
    /** 事件类型 */
    type: string;
    /** 事件发生时间（毫秒时间戳） */
    timestamp: number;
    /** 事件来源 */
    source: EventSource;
    /** 回复 Token（用于回复消息，30 秒内有效） */
    replyToken?: string;
    /** Webhook 事件 ID */
    webhookEventId: string;
    /** 投递上下文 */
    deliveryContext: {
        isRedelivery: boolean;
    };
    /** 模式（active 或 standby） */
    mode: 'active' | 'standby';
}

/**
 * 事件来源
 */
export type EventSource = UserSource | GroupSource | RoomSource;

export interface UserSource {
    type: 'user';
    userId: string;
}

export interface GroupSource {
    type: 'group';
    groupId: string;
    userId?: string;
}

export interface RoomSource {
    type: 'room';
    roomId: string;
    userId?: string;
}

/**
 * 消息事件
 */
export interface MessageEvent extends WebhookEvent {
    type: 'message';
    replyToken: string;
    message: Message;
}

/**
 * 关注事件
 */
export interface FollowEvent extends WebhookEvent {
    type: 'follow';
    replyToken: string;
}

/**
 * 取消关注事件
 */
export interface UnfollowEvent extends WebhookEvent {
    type: 'unfollow';
}

/**
 * 加入群组/聊天室事件
 */
export interface JoinEvent extends WebhookEvent {
    type: 'join';
    replyToken: string;
}

/**
 * 离开群组/聊天室事件
 */
export interface LeaveEvent extends WebhookEvent {
    type: 'leave';
}

/**
 * 成员加入事件
 */
export interface MemberJoinedEvent extends WebhookEvent {
    type: 'memberJoined';
    replyToken: string;
    joined: {
        members: Array<{ type: 'user'; userId: string }>;
    };
}

/**
 * 成员离开事件
 */
export interface MemberLeftEvent extends WebhookEvent {
    type: 'memberLeft';
    left: {
        members: Array<{ type: 'user'; userId: string }>;
    };
}

/**
 * Postback 事件
 */
export interface PostbackEvent extends WebhookEvent {
    type: 'postback';
    replyToken: string;
    postback: {
        data: string;
        params?: {
            date?: string;
            time?: string;
            datetime?: string;
            newRichMenuAliasId?: string;
            status?: 'SUCCESS' | 'RICHMENU_ALIAS_ID_NOTFOUND' | 'RICHMENU_NOTFOUND' | 'FAILED';
        };
    };
}

// ============================================
// 消息类型
// ============================================

/**
 * 消息基础类型
 */
export type Message =
    | TextMessage
    | ImageMessage
    | VideoMessage
    | AudioMessage
    | FileMessage
    | LocationMessage
    | StickerMessage;

export interface TextMessage {
    id: string;
    type: 'text';
    text: string;
    emojis?: Array<{
        index: number;
        length: number;
        productId: string;
        emojiId: string;
    }>;
    mention?: {
        mentionees: Array<{
            index: number;
            length: number;
            userId?: string;
            type: 'user' | 'all';
        }>;
    };
    quotedMessageId?: string;
}

export interface ImageMessage {
    id: string;
    type: 'image';
    contentProvider: ContentProvider;
    imageSet?: {
        id: string;
        index: number;
        total: number;
    };
}

export interface VideoMessage {
    id: string;
    type: 'video';
    duration: number;
    contentProvider: ContentProvider;
}

export interface AudioMessage {
    id: string;
    type: 'audio';
    duration: number;
    contentProvider: ContentProvider;
}

export interface FileMessage {
    id: string;
    type: 'file';
    fileName: string;
    fileSize: number;
}

export interface LocationMessage {
    id: string;
    type: 'location';
    title: string;
    address: string;
    latitude: number;
    longitude: number;
}

export interface StickerMessage {
    id: string;
    type: 'sticker';
    packageId: string;
    stickerId: string;
    stickerResourceType: 'STATIC' | 'ANIMATION' | 'SOUND' | 'ANIMATION_SOUND' | 'POPUP' | 'POPUP_SOUND' | 'CUSTOM' | 'MESSAGE';
    keywords?: string[];
    text?: string;
}

export interface ContentProvider {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
}

// ============================================
// 发送消息类型
// ============================================

/**
 * 发送消息基础类型
 */
export type SendMessage =
    | SendTextMessage
    | SendImageMessage
    | SendVideoMessage
    | SendAudioMessage
    | SendLocationMessage
    | SendStickerMessage
    | SendTemplateMessage
    | SendFlexMessage;

export interface SendTextMessage {
    type: 'text';
    text: string;
    emojis?: Array<{
        index: number;
        productId: string;
        emojiId: string;
    }>;
    quoteToken?: string;
}

export interface SendImageMessage {
    type: 'image';
    originalContentUrl: string;
    previewImageUrl: string;
}

export interface SendVideoMessage {
    type: 'video';
    originalContentUrl: string;
    previewImageUrl: string;
    trackingId?: string;
}

export interface SendAudioMessage {
    type: 'audio';
    originalContentUrl: string;
    duration: number;
}

export interface SendLocationMessage {
    type: 'location';
    title: string;
    address: string;
    latitude: number;
    longitude: number;
}

export interface SendStickerMessage {
    type: 'sticker';
    packageId: string;
    stickerId: string;
    quoteToken?: string;
}

export interface SendTemplateMessage {
    type: 'template';
    altText: string;
    template: TemplateObject;
}

export interface SendFlexMessage {
    type: 'flex';
    altText: string;
    contents: FlexContainer;
}

// 模板和 Flex 消息的简化类型（完整类型非常复杂）
export type TemplateObject = Record<string, unknown>;
export type FlexContainer = Record<string, unknown>;

// ============================================
// 用户资料类型
// ============================================

/**
 * 用户资料
 */
export interface UserProfile {
    displayName: string;
    userId: string;
    pictureUrl?: string;
    statusMessage?: string;
    language?: string;
}

/**
 * 群组成员资料
 */
export interface GroupMemberProfile {
    displayName: string;
    userId: string;
    pictureUrl?: string;
}

/**
 * 群组信息
 */
export interface GroupSummary {
    groupId: string;
    groupName: string;
    pictureUrl?: string;
}

/**
 * 群组成员数量
 */
export interface GroupMemberCount {
    count: number;
}

// ============================================
// API 响应类型
// ============================================

/**
 * 发送消息响应
 */
export interface SendMessageResponse {
    sentMessages: Array<{
        id: string;
        quoteToken?: string;
    }>;
}

/**
 * 错误响应
 */
export interface ErrorResponse {
    message: string;
    details?: Array<{
        message: string;
        property: string;
    }>;
}

