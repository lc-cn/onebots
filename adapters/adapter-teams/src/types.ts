/**
 * Microsoft Teams Bot Framework 类型定义
 * 基于 Bot Framework SDK
 */

// 配置类型
export interface TeamsConfig {
    account_id: string;
    app_id: string;              // Microsoft App ID
    app_password: string;         // Microsoft App Password
    webhook?: {
        url?: string;             // Webhook URL（可选）
        port?: number;            // Webhook 端口
    };
    // Bot Framework 配置
    channel_service?: string;     // Channel Service URL（可选，用于政府云等）
    open_id_metadata?: string;    // OpenID Metadata URL（可选）
}

// Teams 用户类型
export interface TeamsUser {
    id: string;
    name: string;
    aadObjectId?: string;
    role?: string;
    tenantId?: string;
}

// Teams 频道类型
export interface TeamsChannel {
    id: string;
    name?: string;
    type: 'standard' | 'private' | 'shared';
    teamId?: string;
}

// Teams channelData 中的 tenant 信息
export interface TeamsChannelDataTenant {
    id?: string;
    name?: string;
}

// Teams channelData 结构
export interface TeamsChannelData {
    channel?: { id?: string; name?: string };
    team?: { id?: string; name?: string };
    tenant?: TeamsChannelDataTenant;
    [key: string]: unknown;
}

// Teams Entity 类型（Bot Framework Entity 的扩展）
export interface TeamsEntity {
    type: string;
    [key: string]: unknown;
}

// Teams 消息类型
export interface TeamsMessage {
    id: string;
    timestamp: string;
    text?: string;
    textFormat?: 'plain' | 'markdown' | 'xml';
    attachments?: TeamsAttachment[];
    from: TeamsUser;
    channelAccount?: TeamsUser;
    conversation?: {
        id: string;
        name?: string;
        isGroup?: boolean;
    };
    channelData?: TeamsChannelData;
    entities?: TeamsEntity[];
    [key: string]: unknown;
}

// Teams 附件类型
export interface TeamsAttachment {
    contentType: string;
    contentUrl?: string;
    content?: Record<string, unknown>;
    name?: string;
    thumbnailUrl?: string;
}

// Teams 活动类型
export interface TeamsActivity {
    type: string;
    id: string;
    timestamp: string;
    from: TeamsUser;
    conversation: {
        id: string;
        name?: string;
        isGroup?: boolean;
    };
    channelId: string;
    channelData?: TeamsChannelData;
    text?: string;
    attachments?: TeamsAttachment[];
    value?: Record<string, unknown>;
    [key: string]: unknown;
}

// Teams 事件类型
export interface TeamsEvent {
    type: 'message' | 'messageUpdate' | 'messageDelete' | 'conversationUpdate' | 'typing' | 'endOfConversation' | 'event' | 'invoke';
    activity: TeamsActivity;
}

// sendMessage / sendCard 的选项
export interface SendMessageOptions {
    isGroup?: boolean;
    conversationName?: string;
    reply_to_message_id?: string;
}

