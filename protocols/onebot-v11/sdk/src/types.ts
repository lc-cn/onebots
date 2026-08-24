/**
 * OneBot V11 Client Types
 */

export interface OneBotV11ClientConfig {
    /** 服务器地址，例如 http://localhost:6727 */
    baseUrl: string;
    /** 访问令牌 */
    accessToken?: string;
    apiBaseUrl?: string;
    resolveActionUrl?: OneBotV11ActionUrlResolver;
    call?: OneBotV11Call;
    fetch?: typeof globalThis.fetch;
    /** 接收方式；manual 仅通过 ingest/acceptHttp/acceptWebSocket 接收。 */
    receiveMode?: "websocket" | "ws" | "wss" | "webhook" | "sse" | "manual";
    /** Webhook 接收地址（当 receiveMode 为 webhook 时使用） */
    webhookUrl?: string;
    /** Webhook 端口（当 receiveMode 为 webhook 时使用） */
    webhookPort?: number;
}

export interface OneBotV11Event {
    post_type: "message" | "notice" | "request" | "meta_event";
    message_type?: "private" | "group";
    notice_type?: string;
    request_type?: string;
    meta_event_type?: string;
    time: number;
    self_id: number;
    user_id?: number;
    message_id?: number;
    group_id?: number;
    operator_id?: number;
    message?: unknown[];
    raw_message?: string;
    sub_type?: string;
    flag?: string;
    comment?: string;
    interval?: number;
    status?: { online: boolean; good: boolean };
    [key: string]: unknown;
}

export interface OneBotV11Response<T = unknown> {
    status: "ok" | "failed";
    retcode: number;
    data?: T;
    message?: string;
    echo?: unknown;
}

export type EventHandler = (event: OneBotV11Event) => void | Promise<void>;

export type OneBotV11Call = (
    action: string,
    params?: Record<string, unknown>,
) => Promise<OneBotV11Response>;

export type OneBotV11ActionUrlResolver = (action: string, apiBaseUrl: string) => string | URL;
