/** Zulip HTTP 代理。 */
export interface ZulipProxyConfig {
    url: string;
    username?: string;
    password?: string;
}

/** Zulip Event Queue 配置。 */
export interface ZulipEventQueueConfig {
    /** 订阅的官方事件类型；默认覆盖消息、反应、成员、频道和状态事件。 */
    event_types?: ZulipEventType[];
    /** 是否接收所有可访问公共频道的消息。 */
    all_public_streams?: boolean;
    /** 断线后的初始退避时间。 */
    retry_initial_delay_ms?: number;
    /** 退避时间上限。 */
    retry_max_delay_ms?: number;
}

/** Zulip 账号配置。 */
export interface ZulipConfig {
    account_id: string;
    /** 使用官方 Event Queue 长轮询，或由外部连接手动投递事件。 */
    receive_mode?: "event_queue" | "manual";
    /** 组织根地址，例如 https://chat.zulip.org。 */
    server_url: string;
    /** Bot 的 Zulip API 邮箱。 */
    email: string;
    /** Bot API Key。 */
    api_key: string;
    /** 仅提供频道 ID 发送时使用的话题。 */
    default_topic?: string;
    proxy?: ZulipProxyConfig;
    event_queue?: ZulipEventQueueConfig;
}

/** 当前发送 API 的 canonical 类型。 */
export type ZulipMessageType = "channel" | "direct";
/** Event Queue 仍使用的消息场景字段。 */
export type ZulipEventMessageType = "stream" | "private" | "channel" | "direct";
export type ZulipHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ZulipParam = string | number | boolean | null | readonly unknown[] | object;
export type ZulipParams = Readonly<Record<string, ZulipParam | undefined>>;

/** Zulip Event Queue 当前公开的事件类型。保留完整清单，供类型和配置界面共用。 */
export const ZULIP_EVENT_TYPES = [
    "alert_words",
    "attachment",
    "channel_folder",
    "custom_profile_fields",
    "default_stream_groups",
    "default_streams",
    "delete_message",
    "device",
    "drafts",
    "has_webex_token",
    "has_zoom_token",
    "heartbeat",
    "invites_changed",
    "message",
    "muted_topics",
    "muted_users",
    "navigation_view",
    "onboarding_steps",
    "presence",
    "reaction",
    "realm",
    "realm_bot",
    "realm_domains",
    "realm_emoji",
    "realm_export",
    "realm_export_consent",
    "realm_filters",
    "realm_linkifiers",
    "realm_playgrounds",
    "realm_user",
    "realm_user_settings_defaults",
    "reminders",
    "restart",
    "saved_snippets",
    "scheduled_messages",
    "stream",
    "submessage",
    "subscription",
    "typing",
    "typing_edit_message",
    "update_message",
    "update_message_flags",
    "user_group",
    "user_settings",
    "user_status",
    "user_topic",
    "web_reload_client",
] as const;

export type ZulipEventType = (typeof ZULIP_EVENT_TYPES)[number];

export interface ZulipApiEnvelope {
    result: "success" | "error";
    msg: string;
    code?: string;
    [key: string]: unknown;
}

export interface ZulipUser {
    user_id: number;
    email: string;
    delivery_email?: string | null;
    full_name: string;
    avatar_url?: string | null;
    is_admin?: boolean;
    is_owner?: boolean;
    is_guest?: boolean;
    is_bot?: boolean;
    role?: number;
    timezone?: string;
    date_joined?: string;
    is_active?: boolean;
}

export interface ZulipStream {
    stream_id: number;
    name: string;
    description?: string;
    date_created?: number;
    invite_only?: boolean;
    is_web_public?: boolean;
    is_archived?: boolean;
    history_public_to_subscribers?: boolean;
    first_message_id?: number | null;
}

export interface ZulipReaction {
    emoji_name: string;
    emoji_code: string;
    reaction_type: string;
    user_id: number;
}

export interface ZulipAttachment {
    id: number;
    name: string;
    size: number;
    path: string;
    create_time?: number;
    messages?: number[];
}

export interface ZulipRecipient {
    id: number;
    email: string;
    full_name: string;
}

/** REST 与 Event Queue 共用的消息对象。 */
export interface ZulipMessage {
    id: number;
    type?: ZulipEventMessageType;
    message_type?: ZulipEventMessageType;
    sender_id: number;
    sender_email: string;
    sender_full_name: string;
    avatar_url?: string | null;
    content: string;
    content_type?: string;
    subject?: string;
    stream_name?: string;
    stream_id?: number;
    display_recipient?: string | ZulipRecipient[];
    timestamp: number;
    client?: string;
    flags?: string[];
    reactions?: ZulipReaction[];
    attachments?: ZulipAttachment[];
    mentioned_user_ids?: number[];
}

export interface ZulipBaseEvent {
    id: number;
    type: string;
    [key: string]: unknown;
}

export interface ZulipMessageEvent extends ZulipBaseEvent {
    type: "message";
    message: ZulipMessage;
    flags?: string[];
}

export interface ZulipUpdateMessageEvent extends ZulipBaseEvent {
    type: "update_message";
    message_id: number;
    user_id: number;
    edit_timestamp: number;
    stream_id?: number;
    topic?: string;
    orig_topic?: string;
    content?: string;
    rendered_content?: string;
}

export interface ZulipDeleteMessageEvent extends ZulipBaseEvent {
    type: "delete_message";
    message_id: number;
    message_type?: ZulipEventMessageType;
    stream_id?: number;
    topic?: string;
}

export interface ZulipReactionEvent extends ZulipBaseEvent {
    type: "reaction";
    op: "add" | "remove";
    message_id: number;
    emoji_name: string;
    emoji_code: string;
    reaction_type: string;
    user_id: number;
    user?: { email?: string; full_name?: string; user_id: number };
}

export interface ZulipHeartbeatEvent extends ZulipBaseEvent {
    type: "heartbeat";
}

export interface ZulipRealmUserEvent extends ZulipBaseEvent {
    type: "realm_user";
    op: "add" | "update" | "remove";
    person?: Record<string, unknown>;
    person_id?: number;
}

export interface ZulipInvitesChangedEvent extends ZulipBaseEvent {
    type: "invites_changed";
}

export interface ZulipAlertWordsEvent extends ZulipBaseEvent {
    type: "alert_words";
    alert_words: string[];
}

export interface ZulipMutedUsersEvent extends ZulipBaseEvent {
    type: "muted_users";
    muted_users: Array<{ id: number; timestamp: number }>;
}

export interface ZulipUserGroupEvent extends ZulipBaseEvent {
    type: "user_group";
    op:
        | "add"
        | "update"
        | "remove"
        | "add_members"
        | "remove_members"
        | "add_subgroups"
        | "remove_subgroups";
    group?: Record<string, unknown>;
    group_id?: number;
    data?: Record<string, unknown>;
    user_ids?: number[];
    direct_subgroup_ids?: number[];
}

export interface ZulipRealmEmoji {
    id: string;
    name: string;
    source_url: string;
    still_url?: string | null;
    deactivated: boolean;
    author_id: number | null;
}

export interface ZulipRealmEmojiAddEvent extends ZulipBaseEvent {
    type: "realm_emoji";
    op: "add";
    emoji: ZulipRealmEmoji;
}

export interface ZulipRealmEmojiUpdateEvent extends ZulipBaseEvent {
    type: "realm_emoji";
    op: "update_one";
    emoji_id: string;
    data: Partial<Pick<ZulipRealmEmoji, "deactivated">> & Record<string, unknown>;
}

export interface ZulipCustomProfileField {
    id: number;
    type: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    order: number;
    name: string;
    hint: string;
    field_data?: string;
    display_in_profile_summary?: boolean;
    required: boolean;
    editable_by_user: boolean;
    use_for_user_matching?: boolean;
}

export interface ZulipCustomProfileFieldsEvent extends ZulipBaseEvent {
    type: "custom_profile_fields";
    fields: ZulipCustomProfileField[];
}

export interface ZulipRealmDomain {
    domain: string;
    allow_subdomains: boolean;
}

export interface ZulipRealmDomainsEvent extends ZulipBaseEvent {
    type: "realm_domains";
    op: "add" | "change" | "remove";
    realm_domain?: ZulipRealmDomain;
    domain?: string;
}

export interface ZulipCodePlayground {
    id: number;
    name: string;
    pygments_language: string;
    url_template: string;
}

export interface ZulipRealmPlaygroundsEvent extends ZulipBaseEvent {
    type: "realm_playgrounds";
    realm_playgrounds: ZulipCodePlayground[];
}

export type ZulipEvent =
    | ZulipMessageEvent
    | ZulipUpdateMessageEvent
    | ZulipDeleteMessageEvent
    | ZulipReactionEvent
    | ZulipHeartbeatEvent
    | ZulipRealmUserEvent
    | ZulipInvitesChangedEvent
    | ZulipAlertWordsEvent
    | ZulipMutedUsersEvent
    | ZulipUserGroupEvent
    | ZulipRealmEmojiAddEvent
    | ZulipRealmEmojiUpdateEvent
    | ZulipCustomProfileFieldsEvent
    | ZulipRealmDomainsEvent
    | ZulipRealmPlaygroundsEvent
    | ZulipBaseEvent;

export interface ZulipQueueRegistration extends ZulipApiEnvelope {
    queue_id: string;
    last_event_id: number;
    event_queue_longpoll_timeout_seconds?: number;
    /** Zulip 12（feature level 481）返回的空闲队列服务端存活时间。 */
    idle_queue_timeout_secs?: number;
    zulip_version?: string;
    zulip_feature_level?: number;
    max_file_upload_size_mib?: number;
}

export interface ZulipEventsResponse extends ZulipApiEnvelope {
    queue_id: string;
    events: ZulipEvent[];
}

export interface ZulipSendMessageParams {
    type: ZulipMessageType;
    to: string | number | readonly (string | number)[];
    topic?: string;
    content: string;
    client?: string;
}

export interface ZulipSendMessageResponse extends ZulipApiEnvelope {
    id: number;
}

export interface ZulipStreamsResponse extends ZulipApiEnvelope {
    streams: ZulipStream[];
}

export interface ZulipUsersResponse extends ZulipApiEnvelope {
    members: ZulipUser[];
}

export interface ZulipUserResponse extends ZulipApiEnvelope {
    user: ZulipUser;
}

export interface ZulipMessageResponse extends ZulipApiEnvelope {
    message: ZulipMessage;
    raw_content: string;
}

export interface ZulipSubscribersResponse extends ZulipApiEnvelope {
    subscribers: number[];
}

export interface ZulipUploadResponse extends ZulipApiEnvelope {
    url: string;
    uri?: string;
    filename?: string;
}
