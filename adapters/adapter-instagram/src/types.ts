import type {
    MetaGraphCallOptions,
    MetaGraphMethod,
    MetaHttpRequest,
    MetaHttpResponse,
    MetaIngestResult,
} from "@onebots/meta";

export type InstagramReceiveMode = "webhook" | "manual";

export interface InstagramConfig {
    account_id: string;
    instagram_user_id: string;
    access_token: string;
    app_secret?: string;
    verify_token?: string;
    receive_mode?: InstagramReceiveMode;
    http_path?: string;
    api_version?: string;
    api_origin?: string;
    max_body_bytes?: number;
    auto_subscribe?: boolean;
    subscribed_fields?: string[];
    event_types?: InstagramEventType[];
    declared_permissions?: string[];
}

export interface InstagramActor {
    id: string;
}

export interface InstagramAttachment {
    type: string;
    payload: Record<string, unknown>;
}

export interface InstagramMessage {
    mid: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_self?: boolean;
    is_unsupported?: boolean;
    attachments?: InstagramAttachment[];
    quick_reply?: { payload: string };
    reply_to?: Record<string, unknown>;
    referral?: Record<string, unknown>;
}

export interface InstagramMessagingItem {
    sender: InstagramActor;
    recipient: InstagramActor;
    timestamp: number;
    message?: InstagramMessage;
    message_edit?: Record<string, unknown>;
    reaction?: Record<string, unknown>;
    postback?: Record<string, unknown>;
    read?: Record<string, unknown>;
    referral?: Record<string, unknown>;
    optin?: Record<string, unknown>;
    pass_thread_control?: Record<string, unknown>;
    take_thread_control?: Record<string, unknown>;
    request_thread_control?: Record<string, unknown>;
    raw: Record<string, unknown>;
}

export interface InstagramChange {
    field: string;
    value: Record<string, unknown>;
}

export interface InstagramEntry {
    id: string;
    time: number;
    messaging: InstagramMessagingItem[];
    standby: InstagramMessagingItem[];
    changes: InstagramChange[];
    raw: Record<string, unknown>;
}

export interface InstagramWebhookEnvelope {
    object: "instagram";
    entry: InstagramEntry[];
    raw: Record<string, unknown>;
}

export const INSTAGRAM_EVENT_TYPES = [
    "message",
    "message_echo",
    "message_deleted",
    "message_unsupported",
    "message_edit",
    "reaction",
    "postback",
    "read",
    "referral",
    "optin",
    "handover",
    "change",
    "unknown",
] as const;

export type InstagramEventType = (typeof INSTAGRAM_EVENT_TYPES)[number];

export const INSTAGRAM_WEBHOOK_FIELDS = [
    "messages",
    "messaging_postbacks",
    "messaging_seen",
    "messaging_handover",
    "messaging_referral",
    "messaging_optins",
    "message_reactions",
    "standby",
    "comments",
    "live_comments",
    "mentions",
    "story_insights",
] as const;

export interface InstagramEvent {
    event_type: InstagramEventType;
    source: "messaging" | "standby" | "change";
    instagram_user_id: string;
    entry_time: number;
    messaging?: InstagramMessagingItem;
    change?: InstagramChange;
}

export interface InstagramDelivery {
    id: string;
    event: InstagramEvent;
    rawEnvelope: InstagramWebhookEnvelope;
}

export type InstagramIngestResult = MetaIngestResult<InstagramEvent, InstagramWebhookEnvelope>;

export interface InstagramClientEvents {
    event: [delivery: InstagramDelivery];
    ready: [];
    error: [error: Error];
    stop: [];
}

export interface InstagramBusinessProfile {
    id: string;
    user_id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    account_type?: string;
}

export interface InstagramUserProfile {
    id: string;
    name?: string;
    username?: string;
    profile_pic?: string;
    follower_count?: number;
    is_user_follow_business?: boolean;
    is_business_follow_user?: boolean;
    is_verified_user?: boolean;
}

export interface InstagramSendResponse {
    recipient_id: string;
    message_id: string;
}

export interface InstagramApiMessage {
    id: string;
    created_time: string;
    from?: { id: string; username?: string };
    to?: { data: Array<{ id: string; username?: string }> };
    message?: string;
}

export interface InstagramConversation {
    id: string;
    updated_time?: string;
    participants?: { data: Array<{ id: string; username?: string }> };
    messages?: { data: InstagramApiMessage[]; paging?: InstagramPaging };
}

export interface InstagramPaging {
    cursors?: { before?: string; after?: string };
}

export interface InstagramList<T> {
    data: T[];
    paging?: InstagramPaging;
}

export interface InstagramOutgoingMessage extends Record<string, unknown> {
    text?: string;
    attachment?: Record<string, unknown>;
    quick_replies?: Record<string, unknown>[];
    reply_to?: { mid: string };
}

export interface InstagramHttpRequest extends MetaHttpRequest {}
export interface InstagramHttpResponse extends MetaHttpResponse {}
export interface InstagramCallOptions extends MetaGraphCallOptions {}
export type InstagramGraphMethod = MetaGraphMethod;
