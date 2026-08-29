/** KOOK 官方机器人配置。 */
export interface KookConfig {
    account_id: string;
    token: string;
    receive_mode?: "gateway" | "webhook" | "manual";
    verify_token?: string;
    encrypt_key?: string;
    api_base_url?: string;
    /** REST 触发限流后的最大自动重试次数，默认 3。 */
    max_retries?: number;
}

export type KookMessageType = 1 | 2 | 3 | 4 | 8 | 9 | 10 | 12 | 255;
export type KookSendMessageType = 1 | 2 | 3 | 4 | 8 | 9 | 10;

export interface KookUser {
    id: string;
    username: string;
    nickname?: string;
    identify_num?: string;
    online?: boolean;
    bot?: boolean;
    status?: number;
    avatar?: string;
    roles?: number[];
    joined_at?: number;
    active_time?: number;
}

export interface KookGuild {
    id: string;
    name: string;
    topic?: string;
    user_id?: string;
    icon?: string;
    default_channel_id?: string;
    welcome_channel_id?: string;
}

export interface KookChannel {
    id: string;
    name: string;
    user_id?: string;
    guild_id?: string;
    topic?: string;
    is_category?: boolean;
    parent_id?: string;
    level?: number;
    slow_mode?: number;
    type?: number;
    permission_sync?: number;
    has_password?: boolean;
}

export interface KookEmoji {
    id?: string;
    name: string;
}

export interface KookEventAuthor extends KookUser {
    identify_num?: string;
}

export interface KookSystemBody {
    user_id?: string;
    target_id?: string;
    channel_id?: string;
    guild_id?: string;
    msg_id?: string;
    content?: string;
    emoji?: KookEmoji;
    [key: string]: unknown;
}

export interface KookEventExtra {
    type?: string | number;
    guild_id?: string;
    channel_name?: string;
    mention?: string[];
    mention_all?: boolean;
    mention_roles?: number[];
    mention_here?: boolean;
    author?: KookEventAuthor;
    body?: KookSystemBody;
    code?: string;
    [key: string]: unknown;
}

/** Gateway 与 Webhook 共享的事件数据结构。 */
export interface KookEvent {
    channel_type: "GROUP" | "PERSON" | "BROADCAST" | "WEBHOOK_CHALLENGE";
    type: KookMessageType;
    target_id: string;
    author_id: string;
    content: unknown;
    msg_id: string;
    msg_timestamp: number;
    nonce?: string;
    verify_token?: string;
    challenge?: string;
    extra: KookEventExtra;
}

export interface KookSignal {
    s: 0 | 1 | 2 | 3 | 5 | 6;
    d?: KookEvent | KookHello;
    sn?: number;
}

export interface KookHello {
    code: number;
    session_id?: string;
}

export interface KookApiEnvelope<T> {
    code: number;
    message?: string;
    data: T;
}

export interface KookPageMeta {
    page?: number;
    page_total?: number;
    page_size?: number;
    total?: number;
}

export interface KookListResponse<T> {
    items: T[];
    meta?: KookPageMeta;
    sort?: Record<string, number>;
}

export interface KookMessageResult {
    msg_id: string;
    msg_timestamp: number;
    nonce?: string;
}

export interface KookMessageView {
    id: string;
    type: KookMessageType;
    content: string;
    create_at: number;
    updated_at?: number;
    author?: KookUser;
    author_id?: string;
    channel_id?: string;
    guild_id?: string;
    code?: string;
    attachments?: Array<Record<string, unknown>>;
    quote?: KookMessageView;
}

export interface KookApiRequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
}

export interface KookSendMessage {
    type: KookSendMessageType;
    content: string;
    quote?: string;
    nonce?: string;
    temp_target_id?: string;
}
