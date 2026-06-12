/**
 * 钉钉开放平台 API 类型定义
 * 基于钉钉开放平台官方 API
 */

// 配置类型
export interface DingTalkConfig {
    account_id: string;
    app_key: string;           // 应用 AppKey
    app_secret: string;        // 应用 AppSecret
    agent_id?: string;         // 企业内部应用的 AgentId（可选）
    encrypt_key?: string;      // 事件加密密钥（可选）
    token?: string;            // 事件验证 Token（可选）
    // Webhook 模式配置
    webhook_url?: string;      // 自定义机器人 Webhook URL（可选）
}

// 钉钉用户类型
export interface DingTalkUser {
    userid: string;
    unionid?: string;
    name: string;
    avatar?: string;
    mobile?: string;
    email?: string;
    department?: number[];
    position?: string;
    is_admin?: boolean;
    is_boss?: boolean;
    is_sys?: boolean;
}

// 钉钉群组类型
export interface DingTalkChat {
    chatid: string;
    name?: string;
    owner?: string;
    conversation_id?: string;
    icon?: string;
}

// 钉钉消息内容（用于 sendMessage 构建）
export interface DingTalkMessageContent {
    text?: string;
    title?: string;
    at?: {
        isAtAll?: boolean;
        atUserIds?: string[];
    };
}

// 钉钉 ActionCard 消息类型
export interface DingTalkActionCard {
    title: string;
    text: string;
    single_title?: string;
    single_url?: string;
    btn_orientation?: '0' | '1';
    btns?: Array<{
        title: string;
        action_url: string;
    }>;
}

// 钉钉 Link 消息类型
export interface DingTalkLink {
    title: string;
    text: string;
    picUrl?: string;
    messageUrl: string;
}

// 钉钉 File 消息类型
export interface DingTalkFile {
    mediaId: string;
    fileName?: string;
    fileSize?: number;
    fileType?: string;
}

// 钉钉 Voice 消息类型
export interface DingTalkVoice {
    mediaId: string;
    duration?: number;
}

// 钉钉 Video 消息类型
export interface DingTalkVideo {
    mediaId: string;
    duration?: number;
    picUrl?: string;
}

// 钉钉消息类型
export interface DingTalkMessage {
    msgId: string;
    createAt: number;
    conversationId: string;
    conversationType: '1' | '2'; // 1=单聊, 2=群聊
    senderId: string;
    senderNick?: string;
    senderCorpId?: string;
    senderStaffId?: string;
    chatbotUserId?: string;
    msgtype: string;
    text?: {
        content: string;
    };
    image?: {
        mediaId: string;
        picUrl?: string;
    };
    markdown?: {
        title: string;
        text: string;
    };
    actionCard?: DingTalkActionCard;
    link?: DingTalkLink;
    file?: DingTalkFile;
    voice?: DingTalkVoice;
    video?: DingTalkVideo;
    [key: string]: unknown;
}

// 钉钉事件数据类型
export interface DingTalkEventData {
    msg?: DingTalkMessage;
    [key: string]: unknown;
}

// 钉钉事件类型
export interface DingTalkEvent {
    eventType: string;
    eventId: string;
    eventTime: number;
    eventCorpId?: string;
    eventData: DingTalkEventData;
}

// 获取用户信息响应
export interface DingTalkUserGetResponse {
    errcode: number;
    errmsg: string;
    result: DingTalkUser;
}

// 访问令牌响应
export interface DingTalkTokenResponse {
    errcode: number;
    errmsg: string;
    access_token?: string;
    expires_in?: number;
}

// 发送消息请求（企业内部应用）
export interface DingTalkSendMessageRequest {
    agent_id?: string;
    userid_list?: string;
    dept_id_list?: string;
    to_all_user?: boolean;
    msg: {
        msgtype: string;
        text?: {
            content: string;
        };
        markdown?: {
            title: string;
            text: string;
        };
        actionCard?: DingTalkActionCard;
        link?: DingTalkLink;
        file?: DingTalkFile;
        image?: {
            media_id: string;
        };
        [key: string]: unknown;
    };
}

// 发送消息响应
export interface DingTalkSendMessageResponse {
    errcode: number;
    errmsg: string;
    task_id?: string;
    request_id?: string;
}

// Webhook 消息请求（自定义机器人）
export interface DingTalkWebhookMessage {
    msgtype: string;
    text?: {
        content: string;
    };
    markdown?: {
        title: string;
        text: string;
    };
    actionCard?: DingTalkActionCard;
    link?: DingTalkLink;
    at?: {
        atMobiles?: string[];
        atUserIds?: string[];
        isAtAll?: boolean;
    };
}

// Webhook 消息响应
export interface DingTalkWebhookResponse {
    errcode: number;
    errmsg: string;
}

