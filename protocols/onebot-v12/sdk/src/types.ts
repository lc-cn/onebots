/**
 * OneBot V12 Client Types
 */

export interface OneBotV12Event {
    id: string;
    time: number;
    type: "message" | "notice" | "request" | "meta";
    detail_type: string;
    sub_type: string;
    /** meta 事件可不携带 self。 */
    self?: {
        platform: string;
        user_id: string;
    };
    user_id?: string;
    message_id?: string;
    /** 消息段，或请求事件的附言。 */
    message?: unknown[] | string;
    group_id?: string;
    channel_id?: string;
    operator_id?: string;
    request_id?: string;
    comment?: string;
    interval?: number;
    status?: {
        good: boolean;
        bots: Array<{ self: { platform: string; user_id: string }; online: boolean }>;
    };
    [key: string]: unknown;
}

export interface OneBotV12Response<T = unknown> {
    status: "ok" | "failed";
    retcode: number;
    data?: T;
    message?: string;
    echo?: unknown;
}

export interface OneBotV12Segment {
    type: string;
    data?: Record<string, unknown>;
}

export type EventHandler = (event: OneBotV12Event) => void | Promise<void>;

export type OneBotV12Call = (
    action: string,
    params?: Record<string, unknown>,
) => Promise<OneBotV12Response>;

export type OneBotV12ActionUrlResolver = (action: string, apiBaseUrl: string) => string | URL;
