/**
 * WhatsApp 适配器类型定义
 * 基于 WhatsApp Business API (Meta Graph API)
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
 * WhatsApp Business API 配置
 */
export interface WhatsAppConfig {
    account_id: string;
    /** WhatsApp Business Account ID */
    businessAccountId: string;
    /** Phone Number ID */
    phoneNumberId: string;
    /** Access Token (永久令牌或临时令牌) */
    accessToken: string;
    /** Webhook 验证令牌 */
    webhookVerifyToken: string;
    /** API 版本，默认 v21.0 */
    apiVersion?: string;
    /** 代理配置（可选） */
    proxy?: ProxyConfig;
    /** Webhook 配置 */
    webhook?: {
        /** Webhook URL */
        url?: string;
        /** 订阅的字段列表 */
        fields?: string[];
    };
}

/**
 * WhatsApp 消息类型
 */
export type WhatsAppMessageType = 
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'location'
    | 'contacts'
    | 'sticker'
    | 'reaction'
    | 'interactive';

/**
 * WhatsApp 消息状态
 */
export type WhatsAppMessageStatus = 
    | 'sent'
    | 'delivered'
    | 'read'
    | 'failed';

/**
 * WhatsApp 消息事件
 */
export interface WhatsAppMessageEvent {
    /** 消息 ID */
    id: string;
    /** 消息类型 */
    type: WhatsAppMessageType;
    /** 发送者电话号码（带国家代码，如 8613800138000） */
    from: string;
    /** 时间戳 */
    timestamp: string;
    /** 文本消息内容 */
    text?: {
        body: string;
    };
    /** 图片消息 */
    image?: {
        id: string;
        mime_type: string;
        sha256: string;
        caption?: string;
    };
    /** 视频消息 */
    video?: {
        id: string;
        mime_type: string;
        sha256: string;
        caption?: string;
    };
    /** 音频消息 */
    audio?: {
        id: string;
        mime_type: string;
    };
    /** 文档消息 */
    document?: {
        id: string;
        filename?: string;
        mime_type: string;
        sha256: string;
        caption?: string;
    };
    /** 位置消息 */
    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
    };
    /** 联系人消息 */
    contacts?: Array<{
        name: {
            formatted_name: string;
            first_name?: string;
            last_name?: string;
        };
        phones?: Array<{
            phone: string;
            type?: string;
        }>;
    }>;
    /** 贴纸消息 */
    sticker?: {
        id: string;
        mime_type: string;
        sha256: string;
        animated: boolean;
    };
    /** 反应消息 */
    reaction?: {
        message_id: string;
        emoji: string;
    };
    /** 交互式消息 */
    interactive?: {
        type: 'button_reply' | 'list_reply';
        button_reply?: {
            id: string;
            title: string;
        };
        list_reply?: {
            id: string;
            title: string;
            description?: string;
        };
    };
    /** 上下文（回复的消息） */
    context?: {
        from: string;
        id: string;
        referred_product?: {
            product_retailer_id: string;
        };
    };
}

/**
 * WhatsApp Webhook 事件
 */
export interface WhatsAppWebhookEvent {
    object: 'whatsapp_business_account';
    entry: Array<{
        id: string;
        changes: Array<{
            value: {
                messaging_product: 'whatsapp';
                metadata: {
                    display_phone_number: string;
                    phone_number_id: string;
                };
                contacts?: Array<{
                    profile: {
                        name: string;
                    };
                    wa_id: string;
                }>;
                messages?: WhatsAppMessageEvent[];
                statuses?: Array<{
                    id: string;
                    status: WhatsAppMessageStatus;
                    timestamp: string;
                    recipient_id: string;
                    errors?: Array<{
                        code: number;
                        title: string;
                        message?: string;
                        error_data?: {
                            details: string;
                        };
                    }>;
                }>;
            };
            field: 'messages' | 'message_status' | 'message_reactions' | 'message_echo';
        }>;
    }>;
}

/**
 * WhatsApp 发送消息参数
 */
export interface WhatsAppSendMessageParams {
    /** 接收者电话号码（带国家代码） */
    to: string;
    /** 消息类型 */
    type: WhatsAppMessageType;
    /** 文本消息内容 */
    text?: {
        body: string;
        preview_url?: boolean;
    };
    /** 图片消息 */
    image?: {
        link?: string;
        id?: string;
        caption?: string;
    };
    /** 视频消息 */
    video?: {
        link?: string;
        id?: string;
        caption?: string;
    };
    /** 音频消息 */
    audio?: {
        link?: string;
        id?: string;
    };
    /** 文档消息 */
    document?: {
        link?: string;
        id?: string;
        filename?: string;
        caption?: string;
    };
    /** 位置消息 */
    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
    };
    /** 联系人消息 */
    contacts?: Array<{
        name: {
            formatted_name: string;
            first_name?: string;
            last_name?: string;
        };
        phones?: Array<{
            phone: string;
            type?: string;
        }>;
    }>;
    /** 模板消息 */
    template?: {
        name: string;
        language: {
            code: string;
        };
        components?: Array<{
            type: 'header' | 'body' | 'button';
            parameters?: Array<{
                type: 'text' | 'image' | 'video' | 'document';
                text?: string;
                image?: { link: string };
                video?: { link: string };
                document?: { link: string };
            }>;
        }>;
    };
    /** 上下文（回复的消息） */
    context?: {
        message_id: string;
    };
}

/**
 * WhatsApp API 响应
 */
export interface WhatsAppAPIResponse {
    messaging_product: 'whatsapp';
    contacts: Array<{
        input: string;
        wa_id: string;
    }>;
    messages: Array<{
        id: string;
    }>;
}

/**
 * WhatsApp Webhook metadata (display_phone_number, phone_number_id)
 */
export interface WhatsAppWebhookMetadata {
    display_phone_number: string;
    phone_number_id: string;
}

/**
 * WhatsApp Message status update event (from 'statuses' in webhook)
 */
export interface WhatsAppMessageStatusEvent {
    id: string;
    status: WhatsAppMessageStatus;
    timestamp: string;
    recipient_id: string;
    errors?: Array<{
        code: number;
        title: string;
        message?: string;
        error_data?: {
            details: string;
        };
    }>;
}
