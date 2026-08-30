/** WhatsApp Cloud API 账号配置。 */
export interface WhatsAppConfig {
    account_id: string;
    /** Meta App Dashboard 中的应用 Secret，用于 Webhook HMAC-SHA256 验签。 */
    app_secret?: string;
    /** WhatsApp Business Account ID。 */
    business_account_id: string;
    /** Cloud API Phone Number ID。 */
    phone_number_id: string;
    /** 具备 whatsapp_business_messaging 权限的访问令牌。 */
    access_token: string;
    /** Meta 配置 Webhook 回调时填写的自定义验证令牌。 */
    webhook_verify_token?: string;
    /** Webhook 由 OneBots 接收，或由已有 Host/队列手动 ingest。 */
    receive_mode?: "webhook" | "manual";
    /** 挂载到 OneBots HTTP Host 的路径，默认使用账号标准路径。 */
    webhook_path?: string;
    /** Graph API 版本，必须显式带 v 前缀。 */
    api_version: string;
    /** 官方兼容网关或测试环境的 Graph API 根地址。 */
    api_base_url?: string;
    /** 是否按 webhook payload 哈希过滤 Meta 重投递，默认开启。 */
    deduplicate_webhooks?: boolean;
    /** 进程内 Webhook 去重缓存上限。 */
    webhook_deduplication_limit?: number;
}

export type WhatsAppMessageType =
    | "text"
    | "image"
    | "video"
    | "audio"
    | "document"
    | "location"
    | "contacts"
    | "sticker"
    | "reaction"
    | "pin"
    | "interactive"
    | "button"
    | "order"
    | "request_welcome"
    | "system"
    | "unknown"
    | "unsupported";

export type WhatsAppMessageStatus = "sent" | "delivered" | "read" | "failed" | "deleted";

export interface WhatsAppMediaObject {
    id: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
    filename?: string;
    animated?: boolean;
}

/** messages Webhook 中的原始消息对象；未知扩展字段会被完整保留。 */
export interface WhatsAppMessageEvent extends Record<string, unknown> {
    id: string;
    type: WhatsAppMessageType;
    from: string;
    /** Groups API 群消息所在群；缺省表示个人会话。 */
    group_id?: string;
    timestamp: string;
    text?: { body: string };
    image?: WhatsAppMediaObject;
    video?: WhatsAppMediaObject;
    audio?: WhatsAppMediaObject & { voice?: boolean };
    document?: WhatsAppMediaObject;
    sticker?: WhatsAppMediaObject;
    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
        url?: string;
    };
    contacts?: WhatsAppContact[];
    reaction?: { message_id: string; emoji: string };
    pin?: { type: "pin" | "unpin"; message_id: string; expiration_days?: number };
    interactive?: {
        type: "button_reply" | "list_reply" | string;
        button_reply?: { id: string; title: string };
        list_reply?: { id: string; title: string; description?: string };
        /** Flow 完成后返回的原生响应。 */
        nfm_reply?: { name?: string; body?: string; response_json?: string };
    };
    button?: { payload?: string; text?: string };
    context?: {
        from?: string;
        id: string;
        forwarded?: boolean;
        frequently_forwarded?: boolean;
        referred_product?: { catalog_id?: string; product_retailer_id: string };
    };
    referral?: Record<string, unknown>;
    errors?: WhatsAppErrorData[];
}

export interface WhatsAppContact {
    addresses?: Array<Record<string, unknown>>;
    birthday?: string;
    emails?: Array<Record<string, unknown>>;
    name: { formatted_name: string; first_name?: string; last_name?: string };
    org?: Record<string, unknown>;
    phones?: Array<{ phone: string; type?: string; wa_id?: string }>;
    urls?: Array<Record<string, unknown>>;
}

export interface WhatsAppErrorData {
    code: number;
    title?: string;
    message?: string;
    href?: string;
    error_data?: { details?: string };
}

export interface WhatsAppMessageStatusEvent extends Record<string, unknown> {
    id: string;
    status: WhatsAppMessageStatus;
    timestamp: string;
    recipient_id: string;
    /** Meta v23 群消息状态中的群 ID。 */
    group_id?: string;
    /** 新版 BSUID 状态载荷中的群成员身份。 */
    recipient_participant_user_id?: string;
    conversation?: Record<string, unknown>;
    pricing?: Record<string, unknown>;
    errors?: WhatsAppErrorData[];
}

export interface WhatsAppWebhookMetadata {
    display_phone_number: string;
    phone_number_id: string;
}

export interface WhatsAppWebhookValue extends Record<string, unknown> {
    messaging_product?: "whatsapp";
    metadata?: WhatsAppWebhookMetadata;
    contacts?: WhatsAppWebhookContact[];
    messages?: WhatsAppMessageEvent[];
    statuses?: WhatsAppMessageStatusEvent[];
    groups?: WhatsAppGroupWebhookEntry[];
    errors?: WhatsAppErrorData[];
}

/** Webhook 用户身份；启用用户名后 wa_id 可能缺失，应优先使用稳定 BSUID。 */
export interface WhatsAppWebhookContact {
    profile: { name: string };
    user_id?: string;
    wa_id?: string;
    username?: string;
}

export interface WhatsAppGroupWebhookError {
    code: string | number;
    message: string;
    title?: string;
    error_data?: { details?: string };
}

export interface WhatsAppGroupIdentityFields {
    user_id?: string;
    wa_id?: string;
    username?: string;
}

type WhatsAppRequiredGroupIdentity = { user_id: string } | { wa_id: string } | { username: string };

export type WhatsAppGroupParticipant = WhatsAppGroupIdentityFields &
    WhatsAppRequiredGroupIdentity & {
        parent_user_id?: string;
    };

export interface WhatsAppGroupDetails {
    messaging_product?: "whatsapp";
    id: string;
    subject: string;
    description?: string;
    suspended: boolean;
    creation_timestamp: string | number;
    total_participant_count: number;
    participants: WhatsAppGroupParticipant[];
    join_approval_mode: "auto_approve" | "approval_required";
}

export interface WhatsAppGroupSummary {
    id: string;
    subject: string;
    created_at: string;
}

export interface WhatsAppPaging {
    cursors?: { before?: string; after?: string };
    previous?: string;
    next?: string;
}

export interface WhatsAppGroupListResponse {
    data: { groups: WhatsAppGroupSummary[] };
    paging?: WhatsAppPaging;
}

export interface WhatsAppGroupPagination {
    limit?: number;
    after?: string;
    before?: string;
}

export interface WhatsAppGroupCreateParams {
    subject: string;
    description?: string;
    join_approval_mode?: "auto_approve" | "approval_required";
}

export interface WhatsAppGroupUpdateParams {
    subject?: string;
    description?: string;
    /** URL、data URL 或适配器支持的本地媒体来源。 */
    profile_picture?: string;
}

export interface WhatsAppGroupOperationResponse {
    request_id: string;
}

export interface WhatsAppGroupInviteLinkResponse {
    messaging_product?: "whatsapp";
    invite_link: string;
}

export interface WhatsAppGroupSuccessResponse {
    success: true;
}

export interface WhatsAppGroupInviteLinkDeletedResponse {
    messaging_product?: "whatsapp";
    success: "true";
}

export interface WhatsAppGroupJoinRequestFailure {
    join_request_id: string;
    errors: WhatsAppGroupWebhookError[];
}

export interface WhatsAppGroupJoinRequestActionResponse {
    messaging_product?: "whatsapp";
    approved_join_requests?: string[];
    rejected_join_requests?: string[];
    failed_join_requests?: WhatsAppGroupJoinRequestFailure[];
    errors?: WhatsAppGroupWebhookError[];
}

export type WhatsAppGroupJoinRequest = WhatsAppGroupIdentityFields &
    WhatsAppRequiredGroupIdentity & {
        join_request_id: string;
        creation_timestamp: string | number;
    };

export interface WhatsAppGroupJoinRequestsResponse {
    data: WhatsAppGroupJoinRequest[];
    paging?: WhatsAppPaging;
}

export interface WhatsAppGroupLifecycleEntry extends Record<string, unknown> {
    timestamp: string;
    group_id: string;
    type: "group_create" | "group_delete";
    request_id: string;
    subject?: string;
    description?: string;
    invite_link?: string;
    join_approval_mode?: "auto_approve" | "approval_required";
    errors?: WhatsAppGroupWebhookError[];
}

interface WhatsAppGroupParticipantsBase extends Record<string, unknown> {
    timestamp: string;
    group_id: string;
    request_id?: string;
    reason?: string;
    initiated_by?: "business" | "participant";
    failed_participants?: Array<{ input: string; errors: WhatsAppGroupWebhookError[] }>;
    errors?: WhatsAppGroupWebhookError[];
}

export interface WhatsAppGroupParticipantsAddedEntry extends WhatsAppGroupParticipantsBase {
    type: "group_add_participants";
    request_id: string;
    added_participants: Array<{ wa_id: string; input?: string }>;
}

export interface WhatsAppGroupParticipantsRemovedEntry extends WhatsAppGroupParticipantsBase {
    type: "group_remove_participants";
    request_id: string;
    removed_participants: Array<{ input: string }>;
}

export interface WhatsAppGroupJoinRequestCreatedEntry extends WhatsAppGroupParticipantsBase {
    type: "group_join_request_created";
    join_request_id: string;
    wa_id: string;
}

export interface WhatsAppGroupJoinRequestRevokedEntry extends WhatsAppGroupParticipantsBase {
    type: "group_join_request_revoked";
    join_request_id: string;
    wa_id: string;
}

export type WhatsAppGroupParticipantsEntry =
    | WhatsAppGroupParticipantsAddedEntry
    | WhatsAppGroupParticipantsRemovedEntry
    | WhatsAppGroupJoinRequestCreatedEntry
    | WhatsAppGroupJoinRequestRevokedEntry;

export interface WhatsAppGroupSettingResult {
    update_successful: boolean;
    mime_type?: string;
    sha256?: string;
    text?: string;
    errors?: WhatsAppGroupWebhookError[];
}

export interface WhatsAppGroupSettingsEntry extends Record<string, unknown> {
    timestamp: string;
    group_id: string;
    type: "group_settings_update";
    request_id: string;
    profile_picture?: WhatsAppGroupSettingResult;
    group_subject?: WhatsAppGroupSettingResult;
    group_description?: WhatsAppGroupSettingResult;
    errors?: WhatsAppGroupWebhookError[];
}

export interface WhatsAppGroupStatusEntry extends Record<string, unknown> {
    timestamp: string;
    group_id: string;
    type: "group_suspend" | "group_suspend_cleared";
}

export type WhatsAppGroupWebhookEntry =
    | WhatsAppGroupLifecycleEntry
    | WhatsAppGroupParticipantsEntry
    | WhatsAppGroupSettingsEntry
    | WhatsAppGroupStatusEntry;

/** Webhook 中已经由 Meta 确认过的联系人资料。 */
export interface WhatsAppObservedContact {
    readonly id: string;
    readonly name: string;
}

export interface WhatsAppWebhookChange {
    field: string;
    value: WhatsAppWebhookValue;
}

export interface WhatsAppWebhookEvent {
    object: "whatsapp_business_account";
    entry: Array<{ id: string; changes: WhatsAppWebhookChange[] }>;
}

export interface WhatsAppSendMessageParams extends Record<string, unknown> {
    messaging_product?: "whatsapp";
    recipient_type?: "individual" | "group";
    to: string;
    type: string;
    context?: { message_id: string };
    text?: { body: string; preview_url?: boolean };
    image?: { link?: string; id?: string; caption?: string };
    video?: { link?: string; id?: string; caption?: string };
    audio?: { link?: string; id?: string };
    document?: { link?: string; id?: string; filename?: string; caption?: string };
    sticker?: { link?: string; id?: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contacts?: WhatsAppContact[];
    reaction?: { message_id: string; emoji: string };
    pin?: { type: "pin" | "unpin"; message_id: string; expiration_days?: number };
    interactive?: Record<string, unknown>;
    template?: Record<string, unknown>;
}

export interface WhatsAppAPIResponse {
    messaging_product: "whatsapp";
    contacts?: Array<{ input: string; wa_id: string }>;
    messages: Array<{ id: string; message_status?: string }>;
}

export interface WhatsAppPhoneNumberInfo {
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: "GREEN" | "YELLOW" | "RED" | "NA";
    code_verification_status?: "VERIFIED" | "UNVERIFIED";
    name_status?:
        | "APPROVED"
        | "AVAILABLE_WITHOUT_REVIEW"
        | "DECLINED"
        | "EXPIRED"
        | "PENDING_REVIEW"
        | "NONE";
}

export interface WhatsAppMediaInfo {
    id: string;
    url: string;
    mime_type?: string;
    sha256?: string;
    file_size?: number;
    messaging_product?: "whatsapp";
}

export interface WhatsAppCallOptions {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    resource: string;
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: unknown;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
}

export interface WhatsAppWebhookRequest {
    body: string | Buffer;
    signature?: string;
}

export interface WhatsAppWebhookResponse {
    status: number;
    body: unknown;
    contentType?: string;
}

/** 所有接入方式共享的事件接收结果。 */
export interface WhatsAppIngestResult {
    accepted: number;
    duplicate: boolean;
    changes: number;
    messages: number;
    statuses: number;
    groupUpdates: number;
    /** 已验签但没有对应已配置 Phone Number Client 的 change 数量。 */
    ignoredChanges: number;
    event: WhatsAppWebhookEvent;
}

export interface WhatsAppVerifiedWebhook {
    event: WhatsAppWebhookEvent;
    deduplicationKey: string;
}

/** WhatsAppClient 对外事件表，参数保持 Cloud API 原始类型。 */
export interface WhatsAppClientEvents {
    ready: [info: WhatsAppPhoneNumberInfo];
    stop: [];
    raw_event: [event: WhatsAppWebhookEvent];
    webhook: [event: WhatsAppWebhookEvent];
    change: [change: WhatsAppWebhookChange, entryId: string];
    message: [
        message: WhatsAppMessageEvent,
        metadata: WhatsAppWebhookMetadata | undefined,
        change: WhatsAppWebhookChange,
    ];
    status: [
        status: WhatsAppMessageStatusEvent,
        metadata: WhatsAppWebhookMetadata | undefined,
        change: WhatsAppWebhookChange,
    ];
    group_update: [entry: WhatsAppGroupWebhookEntry, change: WhatsAppWebhookChange];
}
