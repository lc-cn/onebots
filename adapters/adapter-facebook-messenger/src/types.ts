import type {
    MetaGraphCallOptions,
    MetaGraphMethod,
    MetaHttpRequest,
    MetaHttpResponse,
    MetaIngestResult,
} from "@onebots/meta";

export type FacebookMessengerReceiveMode = "webhook" | "manual";
export type FacebookMessengerMessagingType = "RESPONSE" | "UPDATE" | "MESSAGE_TAG" | "UTILITY";
export type FacebookMessengerDefaultMessagingType = Exclude<
    FacebookMessengerMessagingType,
    "UTILITY"
>;
export type FacebookMessengerSenderAction = "mark_seen" | "typing_on" | "typing_off";

export interface FacebookMessengerConfig {
    account_id: string;
    page_id: string;
    page_access_token: string;
    app_secret?: string;
    verify_token?: string;
    receive_mode?: FacebookMessengerReceiveMode;
    http_path?: string;
    api_version?: string;
    api_origin?: string;
    max_body_bytes?: number;
    auto_subscribe?: boolean;
    subscribed_fields?: string[];
    event_types?: FacebookMessengerEventType[];
    declared_permissions?: string[];
    default_messaging_type?: FacebookMessengerDefaultMessagingType;
    default_message_tag?: string;
}

export interface MessengerActor {
    id: string;
}

export interface MessengerAttachment {
    type: string;
    payload: Record<string, unknown>;
}

export interface MessengerMessage {
    mid: string;
    text?: string;
    is_echo?: boolean;
    app_id?: number;
    metadata?: string;
    attachments?: MessengerAttachment[];
    quick_reply?: { payload: string };
    reply_to?: { mid: string };
    referral?: Record<string, unknown>;
}

export interface MessengerMessagingItem {
    sender: MessengerActor;
    recipient: MessengerActor;
    timestamp: number;
    message?: MessengerMessage;
    delivery?: Record<string, unknown>;
    read?: Record<string, unknown>;
    postback?: Record<string, unknown>;
    reaction?: Record<string, unknown>;
    message_edit?: Record<string, unknown>;
    optin?: Record<string, unknown>;
    account_linking?: Record<string, unknown>;
    referral?: Record<string, unknown>;
    pass_thread_control?: Record<string, unknown>;
    take_thread_control?: Record<string, unknown>;
    request_thread_control?: Record<string, unknown>;
    policy_enforcement?: Record<string, unknown>;
    feedback?: Record<string, unknown>;
    game_play?: Record<string, unknown>;
    raw: Record<string, unknown>;
}

export interface MessengerChange {
    field: string;
    value: Record<string, unknown>;
}

export interface MessengerEntry {
    id: string;
    time: number;
    messaging: MessengerMessagingItem[];
    standby: MessengerMessagingItem[];
    changes: MessengerChange[];
    raw: Record<string, unknown>;
}

export interface MessengerWebhookEnvelope {
    object: "page";
    entry: MessengerEntry[];
    raw: Record<string, unknown>;
}

export const FACEBOOK_MESSENGER_EVENT_TYPES = [
    "message",
    "message_echo",
    "message_edit",
    "delivery",
    "read",
    "reaction",
    "postback",
    "referral",
    "optin",
    "account_linking",
    "handover",
    "policy_enforcement",
    "feedback",
    "game_play",
    "change",
    "unknown",
] as const;

export type FacebookMessengerEventType = (typeof FACEBOOK_MESSENGER_EVENT_TYPES)[number];

export const FACEBOOK_MESSENGER_WEBHOOK_FIELDS = [
    "messages",
    "message_deliveries",
    "message_echoes",
    "message_edits",
    "message_reactions",
    "message_reads",
    "messaging_account_linking",
    "messaging_feedback",
    "messaging_game_plays",
    "messaging_handovers",
    "messaging_optins",
    "messaging_policy_enforcement",
    "messaging_postbacks",
    "messaging_referrals",
    "messenger_template_status_update",
    "response_feedback",
    "send_cart",
    "standby",
] as const;

export interface FacebookMessengerEvent {
    event_type: FacebookMessengerEventType;
    source: "messaging" | "standby" | "change";
    page_id: string;
    entry_time: number;
    messaging?: MessengerMessagingItem;
    change?: MessengerChange;
}

export interface FacebookMessengerDelivery {
    id: string;
    event: FacebookMessengerEvent;
    rawEnvelope: MessengerWebhookEnvelope;
}

export type FacebookMessengerIngestResult = MetaIngestResult<
    FacebookMessengerEvent,
    MessengerWebhookEnvelope
>;

export interface FacebookMessengerClientEvents {
    event: [delivery: FacebookMessengerDelivery];
    ready: [];
    error: [error: Error];
    stop: [];
}

export interface MessengerPageProfile {
    id: string;
    name: string;
    picture?: string;
}

export interface MessengerUserProfile {
    id: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    profile_pic?: string;
    locale?: string;
    timezone?: number;
    gender?: string;
}

export interface MessengerSendResponse {
    recipient_id: string;
    message_id?: string;
}

export interface MessengerApiMessage {
    id: string;
    created_time: string;
    from?: { id: string; name?: string };
    to?: { data: Array<{ id: string; name?: string }> };
    message?: string;
    attachments?: { data: Array<Record<string, unknown>> };
    reply_to?: { mid: string; is_self_reply?: boolean };
}

export interface MessengerConversation {
    id: string;
    link?: string;
    updated_time?: string;
    message_count?: number;
    participants?: { data: Array<{ id: string; name?: string }> };
    messages?: { data: MessengerApiMessage[]; paging?: MessengerPaging };
}

export interface MessengerPaging {
    cursors?: { before?: string; after?: string };
}

export interface MessengerList<T> {
    data: T[];
    paging?: MessengerPaging;
}

export interface FacebookMessengerHttpRequest extends MetaHttpRequest {}
export interface FacebookMessengerHttpResponse extends MetaHttpResponse {}
export interface FacebookMessengerCallOptions extends MetaGraphCallOptions {}
export type FacebookMessengerGraphMethod = MetaGraphMethod;

export interface MessengerOutgoingMessage extends Record<string, unknown> {
    text?: string;
    attachment?: Record<string, unknown>;
    attachments?: Record<string, unknown>[];
    quick_replies?: Record<string, unknown>[];
    reply_to?: { mid: string };
}
