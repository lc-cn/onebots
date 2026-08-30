import type { ZulipEvent, ZulipEventType } from "./event-types.js";

export * from "./event-types.js";

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
    /** 附件 API 与事件中的仓库相对路径。 */
    path_id?: string;
    create_time?: number;
    message_ids?: number[];
    /** Zulip 12 之前的附件引用字段。 */
    messages?: Array<{ id: number; date_sent: number }>;
}

/** 消息对象使用已可访问的 path，而附件管理 API 使用 path_id。 */
export interface ZulipMessageAttachment extends ZulipAttachment {
    path: string;
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
    attachments?: ZulipMessageAttachment[];
    mentioned_user_ids?: number[];
}

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
