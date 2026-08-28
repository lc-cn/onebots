/**
 * OneBot V11 Client Types
 */

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
