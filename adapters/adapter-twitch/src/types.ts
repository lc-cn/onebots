import type { WebSocket } from "ws";

export type TwitchReceiveMode = "websocket" | "webhook" | "manual";
export type TwitchHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TwitchSubscriptionConfig {
    type: string;
    version?: string;
    broadcaster_user_id?: string;
    user_id?: string;
    moderator_user_id?: string;
    from_broadcaster_user_id?: string;
    to_broadcaster_user_id?: string;
    reward_id?: string;
    organization_id?: string;
    category_id?: string;
    campaign_id?: string;
    client_id?: string;
    conduit_id?: string;
    extension_client_id?: string;
}

export interface TwitchNormalizedSubscription {
    type: string;
    version: string;
    condition: Record<string, string>;
    is_batching_enabled?: true;
}

/** Twitch 账号配置。主动 EventSub、已有 Host 与 manual ingress 共用同一 Client。 */
export interface TwitchConfig {
    account_id: string;
    client_id: string;
    access_token: string;
    broadcaster_user_id: string;
    bot_user_id?: string;
    moderator_user_id?: string;
    receive_mode?: TwitchReceiveMode;
    subscriptions?: TwitchSubscriptionConfig[];
    auto_subscribe?: boolean;
    webhook_callback_url?: string;
    /** OneBots 内建 Koa Host 的本地挂载路径；可与公网 callback 路径不同。 */
    http_path?: string;
    webhook_secret?: string;
    api_base_url?: string;
    eventsub_websocket_url?: string;
    keepalive_timeout_seconds?: number;
    reconnect_initial_delay_ms?: number;
    reconnect_max_delay_ms?: number;
    connect_timeout_ms?: number;
    max_response_bytes?: number;
    webhook_tolerance_seconds?: number;
}

/** `GET https://id.twitch.tv/oauth2/validate` 的稳定响应投影。 */
export interface TwitchTokenInfo {
    client_id: string;
    login?: string;
    scopes: string[];
    user_id?: string;
    expires_in: number;
}

export interface TwitchEventSubMetadata {
    message_id: string;
    message_type:
        | "session_welcome"
        | "session_keepalive"
        | "notification"
        | "session_reconnect"
        | "revocation"
        | "webhook_callback_verification";
    message_timestamp: string;
    subscription_type?: string;
    subscription_version?: string;
}

export interface TwitchEventSubSession {
    id: string;
    status: string;
    connected_at: string;
    keepalive_timeout_seconds: number | null;
    reconnect_url: string | null;
}

export interface TwitchEventSubSubscription {
    id: string;
    status: string;
    type: string;
    version: string;
    cost: number;
    condition: Record<string, string>;
    transport: Record<string, unknown>;
    created_at: string;
}

export interface TwitchEventSubMessage {
    metadata: TwitchEventSubMetadata;
    payload: {
        session?: TwitchEventSubSession;
        subscription?: TwitchEventSubSubscription;
        event?: Record<string, unknown>;
        /** Drops 等官方批量投递。 */
        events?: Record<string, unknown>[];
        challenge?: string;
    };
}

export interface TwitchDelivery {
    envelope: TwitchEventSubMessage;
    subscription?: TwitchEventSubSubscription;
    event?: Record<string, unknown>;
    batchIndex?: number;
}

export interface TwitchIngestResult {
    accepted: boolean;
    duplicate: boolean;
    filtered: boolean;
    deliveries: TwitchDelivery[];
}

export interface TwitchCallOptions {
    query?: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Readonly<Record<string, string>>;
}

export interface TwitchApiResponse<T = unknown> {
    data?: T[];
    pagination?: { cursor?: string };
    total?: number;
    total_cost?: number;
    max_total_cost?: number;
    [key: string]: unknown;
}

export interface TwitchUser {
    id: string;
    login: string;
    display_name: string;
    type: string;
    broadcaster_type: string;
    description: string;
    profile_image_url: string;
    offline_image_url: string;
    view_count?: number;
    email?: string;
    created_at: string;
}

export interface TwitchChannel {
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    broadcaster_language: string;
    game_id: string;
    game_name: string;
    title: string;
    delay: number;
    tags?: string[];
    content_classification_labels?: string[];
    is_branded_content?: boolean;
}

export interface TwitchStream {
    id: string;
    user_id: string;
    user_login: string;
    user_name: string;
    game_id: string;
    game_name: string;
    type: "live" | "";
    title: string;
    viewer_count: number;
    started_at: string;
    language: string;
    thumbnail_url: string;
    tag_ids?: string[];
    tags?: string[];
    is_mature: boolean;
}

export interface TwitchChatMessageResponse {
    message_id: string;
    is_sent: boolean;
    drop_reason?: { code: string; message: string };
}

export interface TwitchChatter {
    user_id: string;
    user_login: string;
    user_name: string;
}

export interface TwitchSocketAttachOptions {
    /** 外部 Host 是否拥有 socket；false 时 stop() 只解绑，不关闭。 */
    owned?: boolean;
    /** 已收到 session_welcome 时可直接提供，避免等待下一帧。 */
    welcome?: TwitchEventSubMessage;
}

export interface TwitchClientEvents {
    ready: [user: TwitchUser];
    connected: [session: TwitchEventSubSession, resumed: boolean];
    disconnected: [error?: Error];
    revocation: [delivery: TwitchDelivery];
    event: [delivery: TwitchDelivery];
    error: [error: Error];
    stop: [];
}

export interface TwitchClientDependencies {
    fetcher?: typeof fetch;
    socketFactory?: (url: string) => WebSocket;
    reportError?: (error: Error) => void;
    now?: () => number;
}
