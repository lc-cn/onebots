/**
 * QQ官方机器人 API 类型定义
 * 基于 https://bot.q.qq.com/wiki 官方文档
 */

// ============================================
// 配置类型
// ============================================

export type ReceiverMode = 'websocket' | 'webhook';

export interface QQConfig {
    account_id: string;
    appId: string;
    secret: string;
    token?: string;
    sandbox?: boolean;
    intents?: QQIntent[];
    removeAt?: boolean;
    maxRetry?: number;
    logLevel?: string;
    // 接收模式配置
    mode?: ReceiverMode;          // 'websocket' 或 'webhook'，默认 'websocket'
}

// ============================================
// Intent 类型
// ============================================

export type QQIntent =
    | 'GUILDS'                      // 频道变更事件
    | 'GUILD_MEMBERS'               // 频道成员变更事件
    | 'GUILD_MESSAGES'              // 频道消息事件（私域）
    | 'PUBLIC_GUILD_MESSAGES'       // 频道消息事件（公域）
    | 'GUILD_MESSAGE_REACTIONS'     // 频道消息表态事件
    | 'DIRECT_MESSAGE'              // 频道私信事件
    | 'GROUP_AT_MESSAGE_CREATE'     // 群聊@消息事件
    | 'C2C_MESSAGE_CREATE'          // 私聊消息事件
    | 'MESSAGE_AUDIT'               // 消息审核事件
    | 'INTERACTION'                 // 互动事件
    | 'OPEN_FORUMS_EVENT';          // 开放论坛事件

// Intent 对应的位值
export const IntentBits: Record<QQIntent, number> = {
    'GUILDS': 1 << 0,
    'GUILD_MEMBERS': 1 << 1,
    'GUILD_MESSAGES': 1 << 9,
    'GUILD_MESSAGE_REACTIONS': 1 << 10,
    'DIRECT_MESSAGE': 1 << 12,
    'OPEN_FORUMS_EVENT': 1 << 18,
    'INTERACTION': 1 << 26,
    'MESSAGE_AUDIT': 1 << 27,
    'GROUP_AT_MESSAGE_CREATE': 1 << 25,
    'C2C_MESSAGE_CREATE': 1 << 25,
    'PUBLIC_GUILD_MESSAGES': 1 << 30,
};

// ============================================
// WebSocket 相关类型
// ============================================

export interface WSPayload {
    op: number;
    d?: any;
    s?: number;
    t?: string;
}

export enum OpCode {
    DISPATCH = 0,           // 服务端推送消息
    HEARTBEAT = 1,          // 客户端发送心跳
    IDENTIFY = 2,           // 客户端发送鉴权
    RESUME = 6,             // 客户端恢复连接
    RECONNECT = 7,          // 服务端通知重新连接
    INVALID_SESSION = 9,    // 服务端通知无效会话
    HELLO = 10,             // 服务端发送心跳间隔
    HEARTBEAT_ACK = 11,     // 服务端确认心跳
    HTTP_CALLBACK_ACK = 12, // 用于回调接口确认
}

export interface GatewayResponse {
    url: string;
    shards?: number;
    session_start_limit?: {
        total: number;
        remaining: number;
        reset_after: number;
        max_concurrency: number;
    };
}

export interface ReadyEvent {
    version: number;
    session_id: string;
    user: QQUser;
    shard: [number, number];
}

// ============================================
// 用户相关类型
// ============================================

export interface QQUser {
    id: string;
    username: string;
    avatar?: string;
    bot?: boolean;
    union_openid?: string;
    union_user_account?: string;
}

export interface QQMember {
    user?: QQUser;
    nick?: string;
    roles?: string[];
    joined_at?: string;
    mute?: boolean;
}

// ============================================
// 频道相关类型
// ============================================

export interface QQGuild {
    id: string;
    name: string;
    icon?: string;
    owner_id?: string;
    owner?: boolean;
    member_count?: number;
    max_members?: number;
    description?: string;
    joined_at?: string;
    channels?: QQChannel[];
    union_world_id?: string;
    union_org_id?: string;
}

export interface QQChannel {
    id: string;
    guild_id: string;
    name: string;
    type: ChannelType;
    sub_type?: ChannelSubType;
    position?: number;
    parent_id?: string;
    owner_id?: string;
    private_type?: PrivateType;
    speak_permission?: SpeakPermission;
    application_id?: string;
    permissions?: string;
    op_user_id?: string;
}

export enum ChannelType {
    TEXT = 0,           // 文字子频道
    VOICE = 2,          // 语音子频道
    CATEGORY = 4,       // 分组
    LIVE = 10005,       // 直播子频道
    APPLICATION = 10006,// 应用子频道
    FORUM = 10007,      // 论坛子频道
}

export enum ChannelSubType {
    CHAT = 0,           // 闲聊
    ANNOUNCEMENT = 1,   // 公告
    GUIDES = 2,         // 攻略
    GAME = 3,           // 开黑
}

export enum PrivateType {
    PUBLIC = 0,         // 公开
    GUILD_ONLY = 1,     // 群主管理员可见
    SPECIFIED = 2,      // 群主管理员+指定成员
}

export enum SpeakPermission {
    INVALID = 0,        // 无效
    ALL = 1,            // 所有人
    ADMIN_AND_ROLES = 2,// 管理员和指定用户
}

// ============================================
// 消息相关类型
// ============================================

export interface QQMessage {
    id: string;
    channel_id?: string;
    guild_id?: string;
    group_openid?: string;
    group_id?: string;
    content?: string;
    timestamp?: string;
    edited_timestamp?: string;
    mention_everyone?: boolean;
    author?: QQUser;
    member?: QQMember;
    attachments?: QQAttachment[];
    embeds?: QQEmbed[];
    mentions?: QQUser[];
    ark?: QQArk;
    seq?: number;
    seq_in_channel?: string;
    message_reference?: QQMessageReference;
    src_guild_id?: string;
    src_channel_id?: string;
}

export interface QQAttachment {
    url: string;
    filename?: string;
    height?: number;
    width?: number;
    size?: number;
    content_type?: string;
}

export interface QQEmbed {
    title?: string;
    prompt?: string;
    thumbnail?: {
        url: string;
    };
    fields?: {
        name: string;
    }[];
}

export interface QQArk {
    template_id: number;
    kv: {
        key: string;
        value?: string;
        obj?: {
            obj_kv: { key: string; value: string }[];
        }[];
    }[];
}

export interface QQMessageReference {
    message_id: string;
    ignore_get_message_error?: boolean;
}

export interface QQKeyboard {
    id?: string;
    content?: {
        rows: {
            buttons: QQButton[];
        }[];
    };
}

export interface QQButton {
    id?: string;
    render_data?: {
        label: string;
        visited_label: string;
        style: number;
    };
    action?: {
        type: number;
        permission?: {
            type: number;
            specify_role_ids?: string[];
            specify_user_ids?: string[];
        };
        data: string;
        reply?: boolean;
        enter?: boolean;
        anchor?: number;
        unsupport_tips?: string;
    };
}

export interface QQMarkdown {
    template_id?: number;
    custom_template_id?: string;
    params?: {
        key: string;
        values: string[];
    }[];
    content?: string;
}

// ============================================
// 发送消息类型
// ============================================

export interface SendMessageParams {
    content?: string;
    embed?: QQEmbed;
    ark?: QQArk;
    message_reference?: QQMessageReference;
    image?: string;
    file_image?: Buffer;
    msg_id?: string;
    event_id?: string;
    markdown?: QQMarkdown;
    keyboard?: QQKeyboard;
    msg_type?: number;
    media?: { file_info: string };
    msg_seq?: number;
}

export interface SendGroupMessageParams extends SendMessageParams {}

export interface SendDMSParams extends SendMessageParams {}

// ============================================
// 群聊相关类型
// ============================================

export interface QQGroup {
    group_openid: string;
    group_id?: string;
    name?: string;
    member_count?: number;
}

// ============================================
// 事件类型
// ============================================

export interface QQMessageEvent {
    id: string;
    author: QQUser;
    content: string;
    timestamp: string;
    channel_id?: string;
    guild_id?: string;
    group_openid?: string;
    group_id?: string;
    member?: QQMember;
    attachments?: QQAttachment[];
    message_reference?: QQMessageReference;
    src_guild_id?: string;
}

export interface QQGuildEvent {
    id: string;
    name: string;
    icon?: string;
    owner_id?: string;
    owner?: boolean;
    member_count?: number;
    max_members?: number;
    description?: string;
    joined_at?: string;
    op_user_id?: string;
}

export interface QQChannelEvent extends QQChannel {
    op_user_id?: string;
}

export interface QQGuildMemberEvent {
    guild_id: string;
    user: QQUser;
    nick?: string;
    roles?: string[];
    joined_at?: string;
    op_user_id?: string;
}

export interface QQReactionEvent {
    user_id: string;
    guild_id: string;
    channel_id: string;
    target: {
        id: string;
        type: number;
    };
    emoji: {
        id: string;
        type: number;
    };
}

export interface QQInteractionEvent {
    id: string;
    type: number;
    scene: string;
    chat_type: number;
    timestamp: string;
    guild_id?: string;
    channel_id?: string;
    user_openid?: string;
    group_openid?: string;
    group_member_openid?: string;
    data: {
        resolved: {
            button_data?: string;
            button_id?: string;
        };
    };
    version: number;
    application_id: string;
}

export interface QQDirectMessageEvent extends QQMessage {
    guild_id: string;
    channel_id: string;
    src_guild_id?: string;
}

export interface QQC2CMessageEvent {
    id: string;
    author: {
        id: string;
        user_openid: string;
    };
    content: string;
    timestamp: string;
    attachments?: QQAttachment[];
}

export interface QQGroupMessageEvent {
    id: string;
    author: {
        id: string;
        member_openid: string;
    };
    content: string;
    timestamp: string;
    group_openid: string;
    group_id?: string;
    attachments?: QQAttachment[];
}

// ============================================
// API 响应类型
// ============================================

export interface QQApiResponse<T = any> {
    code?: number;
    message?: string;
    data?: T;
    trace_id?: string;
}

export interface MessageSendResult {
    id: string;
    timestamp?: string;
}

export interface DMS {
    guild_id: string;
    channel_id: string;
    create_time: string;
}

// ============================================
// 富媒体上传类型
// ============================================

export interface MediaUploadParams {
    file_type: 1 | 2 | 3 | 4; // 1:图片 2:视频 3:语音 4:文件
    url: string;
    srv_send_msg?: boolean;
    file_data?: string;
}

export interface MediaUploadResult {
    file_uuid?: string;
    file_info?: string;
    ttl?: number;
    id?: string;
}

// ============================================
// Webhook 相关类型
// ============================================

export interface WebhookPayload {
    op: number;           // 操作码
    d?: any;              // 事件数据
    id?: string;          // 事件ID
    t?: string;           // 事件类型
    s?: number;           // 序列号
}

export interface WebhookValidation {
    plain_token: string;
    event_ts: string;
}

export interface WebhookValidationResponse {
    plain_token: string;
    signature: string;
}
