/**
 * KOOK (开黑了) API 类型定义
 * 基于 KOOK 开发者平台官方 API
 */

// 配置类型
export interface KookConfig {
    account_id: string;
    token: string;           // Bot Token
    verifyToken?: string;    // Webhook 验证 Token
    encryptKey?: string;     // 消息加密 Key
    mode?: 'webhook' | 'websocket'; // 连接模式，默认 websocket
    maxRetry?: number;       // 最大重连次数，默认 10
}

// 用户类型
export interface KookUser {
    id: string;
    username: string;
    nickname?: string;
    identify_num: string;      // 用户标识号
    online: boolean;
    bot?: boolean;
    status: number;            // 用户状态 0=正常 10=封禁
    avatar: string;
    vip_avatar?: string;
    mobile_verified?: boolean;
    roles?: number[];          // 用户所在服务器的角色 ID 列表
    joined_at?: number;        // 加入服务器时间
    active_time?: number;      // 活跃时间
}

// 服务器（公会）类型
export interface KookGuild {
    id: string;
    name: string;
    topic: string;
    user_id: string;           // 创建者 ID
    icon: string;
    notify_type: number;       // 通知类型
    region: string;
    enable_open: boolean;      // 是否为公开服务器
    open_id: string;           // 公开服务器 ID
    default_channel_id: string;
    welcome_channel_id: string;
    roles?: KookRole[];
    channels?: KookChannel[];
}

// 频道类型
export interface KookChannel {
    id: string;
    name: string;
    user_id: string;           // 创建者 ID
    guild_id: string;
    topic: string;
    is_category: boolean;      // 是否为分组
    parent_id: string;         // 分组 ID
    level: number;             // 排序等级
    slow_mode: number;         // 慢速模式下限制发言的时间间隔（秒）
    type: number;              // 频道类型 1=文字 2=语音
    permission_overwrites?: KookPermissionOverwrite[];
    permission_users?: KookPermissionUser[];
    permission_sync: number;   // 权限设置是否与分组同步
    has_password: boolean;     // 是否有密码
}

// 权限用户
export interface KookPermissionUser {
    user: KookUser;
    allow: number;
    deny: number;
}

// 嵌入内容
export interface KookEmbed {
    type: string;
    url?: string;
    origin_url?: string;
    av_no?: string;
    iframe_path?: string;
    duration?: number;
    title?: string;
    pic?: string;
}

// @提及信息
export interface KookMentionInfo {
    mention_part?: KookUser[];
    mention_role_part?: KookRole[];
}

// 卡片消息模块
export interface KookCardModule {
    type: string;
    text?: { type: string; content: string };
    elements?: KookCardModule[];
    src?: string;
}

// 卡片消息
export interface KookCard {
    type: 'card';
    theme?: string;
    size?: 'sm' | 'lg';
    modules: KookCardModule[];
}

// 系统消息 body
export interface KookSystemMessageBody {
    user_id?: string;
    msg_id?: string;
    content?: string;
    emoji?: KookEmoji;
    [key: string]: string | number | boolean | KookEmoji | undefined;
}

// 角色类型
export interface KookRole {
    role_id: number;
    name: string;
    color: number;
    position: number;
    hoist: number;             // 是否单独显示
    mentionable: number;       // 是否可被提及
    permissions: number;       // 权限掩码
}

// 权限覆盖
export interface KookPermissionOverwrite {
    role_id: number;
    allow: number;
    deny: number;
}

// 消息类型
export type KookMessageType = 1 | 2 | 3 | 4 | 8 | 9 | 10 | 255;
// 1=文字 2=图片 3=视频 4=文件 8=音频 9=KMarkdown 10=Card 255=系统

// 频道消息
export interface KookChannelMessage {
    id: string;
    type: KookMessageType;
    content: string;
    mention: string[];          // @用户 ID 列表
    mention_all: boolean;
    mention_roles: number[];    // @角色 ID 列表
    mention_here: boolean;
    embeds: KookEmbed[];
    attachments: KookAttachment[];
    create_at: number;
    updated_at: number;
    reactions: KookReaction[];
    author: KookUser;
    image_name?: string;
    read_status?: boolean;
    quote?: KookChannelMessage;
    mention_info?: KookMentionInfo;
}

// 私聊消息
export interface KookDirectMessage {
    id: string;
    type: KookMessageType;
    content: string;
    embeds: KookEmbed[];
    attachments: KookAttachment[];
    create_at: number;
    updated_at: number;
    reactions: KookReaction[];
    author_id: string;
    image_name?: string;
    read_status?: boolean;
    quote?: KookDirectMessage;
    nonce?: string;
}

// 附件
export interface KookAttachment {
    type: string;
    url: string;
    name: string;
    file_type?: string;
    size?: number;
    duration?: number;
    width?: number;
    height?: number;
}

// 表情回应
export interface KookReaction {
    emoji: KookEmoji;
    count: number;
    me: boolean;
}

// 表情
export interface KookEmoji {
    id: string;
    name: string;
}

// 亲密度信息
export interface KookIntimacy {
    img_url: string;
    social_info: string;
    last_read: number;
    score: number;
    img_list: Array<{
        id: string;
        url: string;
    }>;
}

// 私信聊天会话
export interface KookUserChat {
    code: string;              // 私信聊天会话 Code
    last_read_time: number;
    latest_msg_time: number;
    unread_count: number;
    is_friend: boolean;
    is_blocked: boolean;
    is_target_blocked: boolean;
    target_info: KookUser;
}

// 游戏信息
export interface KookGame {
    id: number;
    name: string;
    type: number;
    options: string;
    kmhook_admin: boolean;
    process_name: string[];
    product_name: string[];
    icon: string;
}

// API 响应
export interface KookApiResponse<T = unknown> {
    code: number;              // 0 表示成功
    message: string;
    data: T;
}

// 分页响应
export interface KookListResponse<T> {
    items: T[];
    meta: KookPageMeta;
    sort?: Record<string, number>;
}

// 分页元数据
export interface KookPageMeta {
    page: number;
    page_total: number;
    page_size: number;
    total: number;
}

// 分页简元数据（Bot API 返回用）
export interface KookSimplePageMeta {
    page_total: number;
}

// Bot 转换后的频道事件
export interface KookTransformedChannelEvent {
    type: number;
    channel_type: 'GROUP';
    author_id: string;
    content: string;
    msg_id: string;
    msg_timestamp: number;
    channel_id: string;
    guild_id: string;
    extra: KookEventExtra;
    _original: ChannelMessageEvent;
}

// Bot 转换后的私聊事件
export interface KookTransformedPrivateEvent {
    type: number;
    channel_type: 'PERSON';
    author_id: string;
    content: string;
    msg_id: string;
    msg_timestamp: number;
    code: string;
    extra: KookEventExtra;
    _original: PrivateMessageEvent;
}

// 频道更新数据
export interface KookChannelUpdateData {
    name?: string;
    topic?: string;
    slow_mode?: number;
}

// 导入用于交叉类型（避免循环依赖，在 bot.ts 中使用）
import type { ChannelMessageEvent, PrivateMessageEvent } from 'kook-client';

// WebSocket 信令
export interface KookSignal {
    s: number;                 // 信令类型
    d: KookEvent | KookWebhookChallenge['d'];  // 数据
    sn?: number;               // 序列号 (仅 s=0 时有)
}

// 信令类型
export const KookSignalType = {
    EVENT: 0,                  // 服务端推送消息
    HELLO: 1,                  // 客户端和服务端的 Hello
    PING: 2,                   // 客户端发送的 Ping
    PONG: 3,                   // 服务端回复的 Pong
    RESUME: 4,                 // 恢复连接
    RECONNECT: 5,              // 服务端通知重连
    RESUME_ACK: 6,             // 恢复成功
} as const;

// 事件类型
export type KookEventType = 
    | 'message'                // 消息事件
    | 'added_reaction'         // 添加表情回应
    | 'deleted_reaction'       // 删除表情回应
    | 'updated_message'        // 消息更新
    | 'deleted_message'        // 消息删除
    | 'pinned_message'         // 置顶消息
    | 'unpinned_message'       // 取消置顶消息
    | 'added_channel'          // 新增频道
    | 'updated_channel'        // 更新频道
    | 'deleted_channel'        // 删除频道
    | 'joined_guild'           // 加入服务器
    | 'exited_guild'           // 退出服务器
    | 'updated_guild_member'   // 成员信息更新
    | 'guild_member_online'    // 成员上线
    | 'guild_member_offline'   // 成员下线
    | 'added_role'             // 新增角色
    | 'deleted_role'           // 删除角色
    | 'updated_role'           // 更新角色
    | 'joined_channel'         // 加入语音频道
    | 'exited_channel'         // 离开语音频道
    | 'user_updated'           // 用户信息更新
    | 'self_joined_guild'      // 自己加入服务器
    | 'self_exited_guild'      // 自己退出服务器
    | 'message_btn_click'      // 消息按钮点击
    | 'added_block_list'       // 黑名单添加
    | 'deleted_block_list'     // 黑名单删除
    | 'private_added_reaction' // 私聊添加表情回应
    | 'private_deleted_reaction'// 私聊删除表情回应
    | 'updated_private_message'// 私聊消息更新
    | 'deleted_private_message'// 私聊消息删除
    ;

// 频道类型
export const KookChannelType = {
    TEXT: 1,                   // 文字频道
    VOICE: 2,                  // 语音频道
} as const;

// 事件数据
export interface KookEvent {
    channel_type: 'GROUP' | 'PERSON' | 'BROADCAST';
    type: number;              // 消息类型
    target_id: string;         // 目标 ID（频道/用户）
    author_id: string;         // 发送者 ID
    content: string;           // 消息内容
    msg_id: string;            // 消息 ID
    msg_timestamp: number;     // 消息发送时间
    nonce: string;             // 随机串
    extra: KookEventExtra;     // 附加信息
}

// 事件附加信息
export interface KookEventExtra {
    type?: KookEventType | number;     // 事件类型（系统消息）或消息类型
    guild_id?: string;                 // 服务器 ID
    channel_name?: string;             // 频道名
    mention?: string[];                // @用户 ID
    mention_all?: boolean;             // @全体
    mention_roles?: number[];          // @角色
    mention_here?: boolean;            // @在线成员
    author?: KookUser;                 // 发送者信息
    body?: KookSystemMessageBody;   // 系统消息具体内容
    code?: string;                     // 私聊会话 Code
    [key: string]: string | number | boolean | string[] | number[] | KookUser | KookSystemMessageBody | undefined;
}

// Webhook 验证请求
export interface KookWebhookChallenge {
    s: 0;
    d: {
        type: 255;
        channel_type: 'WEBHOOK_CHALLENGE';
        challenge: string;
        verify_token: string;
    };
}

// 发送消息参数
export interface KookSendMessageParams {
    type?: KookMessageType;    // 消息类型，默认 1
    target_id: string;         // 目标 ID
    content: string;           // 消息内容
    quote?: string;            // 引用消息 ID
    nonce?: string;            // 随机串
    temp_target_id?: string;   // 临时目标用户 ID（仅对其可见）
}

// 发送私聊消息参数
export interface KookSendDirectMessageParams {
    type?: KookMessageType;    // 消息类型，默认 1
    target_id?: string;        // 目标用户 ID
    chat_code?: string;        // 私聊会话 Code
    content: string;           // 消息内容
    quote?: string;            // 引用消息 ID
    nonce?: string;            // 随机串
}
