/**
 * 飞书开放平台 API 类型定义
 * 基于飞书开放平台官方 API
 */

/**
 * API 端点常量
 * - FEISHU: 飞书（国内版）
 * - LARK: Lark（国际版）
 */
export const FeishuEndpoint = {
    /** 飞书（国内版）API 端点 */
    FEISHU: "https://open.feishu.cn/open-apis",
    /** Lark（国际版）API 端点 */
    LARK: "https://open.larksuite.com/open-apis",
} as const;

export type FeishuEndpointType = (typeof FeishuEndpoint)[keyof typeof FeishuEndpoint];
export type FeishuReceiveIdType = "open_id" | "user_id" | "union_id" | "email" | "chat_id";

/** 飞书开放平台底层请求选项。 */
export interface FeishuApiRequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    params?: Record<string, string | number | boolean>;
    skipAuth?: boolean;
}

/** 飞书开放平台所有 JSON API 响应共享的最小结构。 */
export interface FeishuApiEnvelope {
    code: number;
    msg: string;
}

// 配置类型
export interface FeishuConfig {
    account_id: string;
    app_id: string; // 应用 App ID
    app_secret: string; // 应用 App Secret
    encrypt_key?: string; // 事件加密密钥（可选）
    verification_token?: string; // 事件验证 Token（可选）
    /** 使用飞书官方长连接接收事件，无需公网 Webhook。 */
    long_connection?: boolean;
    /**
     * API 端点，可选值：
     * - FeishuEndpoint.FEISHU (默认): 'https://open.feishu.cn/open-apis'
     * - FeishuEndpoint.LARK: 'https://open.larksuite.com/open-apis'
     * - 或自定义端点 URL
     */
    endpoint?: string;
}

// 飞书用户类型
export interface FeishuUser {
    user_id: string;
    union_id?: string;
    open_id: string;
    name: string;
    en_name?: string;
    nickname?: string;
    email?: string;
    avatar_url?: string;
    avatar_thumb?: string;
    avatar_middle?: string;
    avatar_big?: string;
    status?: number;
}

// 飞书群组类型
export interface FeishuChat {
    chat_id: string;
    name?: string;
    description?: string;
    avatar?: string;
    owner_id?: string;
    owner_id_type?: string;
    external?: boolean;
    tenant_key?: string;
}

// 飞书消息类型
export interface FeishuMessage {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    msg_type: string;
    create_time: string;
    update_time?: string;
    deleted?: boolean;
    updated?: boolean;
    chat_id: string;
    sender: {
        id: string;
        id_type: string;
        sender_type: string;
        tenant_key?: string;
    };
    body: {
        content: string;
    };
    mentions?: Array<{
        key: string;
        id: string;
        id_type: string;
        name: string;
        tenant_key?: string;
    }>;
}

// 飞书事件的通用事件载荷
export interface FeishuMessageReceiveEventPayload {
    message: {
        message_id: string;
        root_id?: string;
        parent_id?: string;
        create_time: string;
        chat_id: string;
        chat_type?: string;
        message_type?: string;
        content?: string;
        body?: {
            content: string;
        };
        sender: {
            id: string;
            id_type: string;
            sender_type: string;
            tenant_key?: string;
        };
        mentions?: Array<{
            key: string;
            id: string;
            id_type: string;
            name: string;
            tenant_key?: string;
        }>;
        [key: string]: unknown;
    };
    sender?: {
        sender_id?: {
            open_id?: string;
            user_id?: string;
            union_id?: string;
        };
        sender_type?: string;
        tenant_key?: string;
    };
    [key: string]: unknown;
}

// 飞书事件类型
export interface FeishuEvent {
    schema: string;
    header: {
        event_id: string;
        event_type: string;
        create_time: string;
        token?: string;
        app_id: string;
        tenant_key: string;
    };
    event: FeishuMessageReceiveEventPayload | Record<string, unknown>;
}

// 访问令牌响应
export interface FeishuTokenResponse extends FeishuApiEnvelope {
    tenant_access_token?: string;
    app_access_token?: string;
    expire: number;
}

// 发送消息请求
export interface FeishuSendMessageRequest {
    receive_id: string;
    msg_type:
        | "text"
        | "post"
        | "image"
        | "file"
        | "audio"
        | "media"
        | "sticker"
        | "interactive"
        | "share_chat"
        | "share_user";
    content: string | Record<string, unknown>;
    uuid?: string;
}

// 发送消息响应
export interface FeishuSendMessageResponse extends FeishuApiEnvelope {
    data: {
        message_id: string;
    };
}

// 飞书通用 API 响应
export interface FeishuAPIResponse extends FeishuApiEnvelope {
    data?: unknown;
    [key: string]: unknown;
}

// 飞书用户信息 API 响应
export interface FeishuUserAPIResponse extends FeishuApiEnvelope {
    data?: {
        user?: FeishuUser;
        [key: string]: unknown;
    };
}

// 飞书群组信息 API 响应
export interface FeishuChatAPIResponse extends FeishuApiEnvelope {
    data?: FeishuChat & {
        [key: string]: unknown;
    };
}

// 飞书群组成员 API 响应
export interface FeishuChatMembersAPIResponse extends FeishuApiEnvelope {
    data?: {
        items?: FeishuUser[];
        page_token?: string;
        has_more?: boolean;
        [key: string]: unknown;
    };
}

// 飞书 Webhook 请求体（URL 验证和事件）
export interface FeishuWebhookBody {
    encrypt?: string;
    type?: string;
    challenge?: string;
    token?: string;
    header?: {
        token?: string;
        event_id?: string;
        event_type?: string;
        create_time?: string;
        app_id?: string;
        tenant_key?: string;
    };
    event?: FeishuMessageReceiveEventPayload | Record<string, unknown>;
    schema?: string;
    [key: string]: unknown;
}
