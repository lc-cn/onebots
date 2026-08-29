/** 企业微信“微信客服”官方 API 配置。 */
export interface WeComKfConfig {
    account_id: string;
    corp_id: string;
    corp_secret: string;
    token: string;
    encoding_aes_key: string;
    open_kfid?: string;
    webhook_path?: string;
    enable_sync_poll?: boolean;
    sync_poll_interval_ms?: number;
    cursor_store_path?: string;
    deduplicate_messages?: boolean;
    message_deduplication_limit?: number;
    api_base_url?: string;
}

export interface KfApiResponse {
    errcode: number;
    errmsg: string;
}

export interface KfTokenResponse extends KfApiResponse {
    access_token?: string;
    expires_in?: number;
}

export interface KfCallOptions {
    method?: "GET" | "POST";
    path: string;
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: unknown;
    token?: boolean;
    response_type?: "json" | "buffer";
    signal?: AbortSignal;
}

export interface KfSyncMsgRequest {
    cursor?: string;
    token?: string;
    limit?: number;
    voice_format?: 0 | 1;
    open_kfid: string;
}

/** sync_msg 返回的完整消息条目；新增平台字段会通过索引签名保留。 */
export interface KfMsgItem extends Record<string, unknown> {
    msgid?: string;
    open_kfid?: string;
    external_userid?: string;
    send_time?: number;
    origin?: number;
    servicer_userid?: string;
    msgtype?: string;
    text?: { content?: string; menu_id?: string };
    image?: { media_id?: string };
    voice?: { media_id?: string };
    video?: { media_id?: string };
    file?: { media_id?: string };
    link?: { title?: string; desc?: string; url?: string; thumb_media_id?: string };
    location?: { latitude?: number; longitude?: number; name?: string; address?: string };
    business_card?: { userid?: string };
    miniprogram?: { appid?: string; title?: string; pagepath?: string; thumb_media_id?: string };
    msgmenu?: Record<string, unknown>;
    event?: Record<string, unknown>;
}

export interface KfSyncMsgResponse extends KfApiResponse {
    next_cursor?: string;
    has_more?: number;
    msg_list?: KfMsgItem[];
}

export interface KfSendMsgResponse extends KfApiResponse {
    msgid?: string;
}

export interface KfCustomer {
    external_userid: string;
    nickname?: string;
    avatar?: string;
    gender?: number;
    unionid?: string;
    enter_session_context?: Record<string, unknown>;
}

export interface KfCustomerBatchGetResponse extends KfApiResponse {
    customer_list?: KfCustomer[];
    invalid_external_userid?: string[];
}

export interface KfServiceStateResponse extends KfApiResponse {
    service_state?: number;
    servicer_userid?: string;
}

export interface KfAccount {
    open_kfid: string;
    name?: string;
    avatar?: string;
    manage_privilege?: boolean;
}

export interface KfCallbackEvent extends Record<string, unknown> {
    MsgType: "event";
    Event: string;
    ToUserName?: string;
    CreateTime?: number;
    Token?: string;
    OpenKfId?: string;
    RawXml?: string;
    EncryptedXml?: string;
}

export interface KfWebhookRequest {
    method: "GET" | "POST";
    query: Readonly<Record<string, unknown>>;
    body?: string | Buffer;
}

export interface KfWebhookResponse {
    status: number;
    body: unknown;
    contentType?: string;
}
