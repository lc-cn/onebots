/** 微信公众号账号配置。 */
export interface WechatConfig {
    account_id: string;
    app_id: string;
    app_secret: string;
    token?: string;
    /** Webhook 由 OneBots 接收，或由已有 Host/队列手动 ingest。 */
    receive_mode?: "webhook" | "manual";
    /** 安全模式或兼容模式必填，43 位。 */
    encoding_aes_key?: string;
    webhook_path?: string;
    /** 等待下游通过 reply 段提交被动回复的时间，默认 4500ms，0 表示立即确认。 */
    passive_reply_timeout_ms?: number;
    /** 是否按 MsgId/事件复合键过滤微信重试，默认开启。 */
    deduplicate_webhooks?: boolean;
    webhook_deduplication_limit?: number;
    api_base_url?: string;
}

/** Webhook Host 已闭合的最小配置。 */
export interface WechatWebhookConfig extends WechatConfig {
    token: string;
    receive_mode?: "webhook";
}

export type WechatMessageType =
    | "text"
    | "image"
    | "voice"
    | "video"
    | "shortvideo"
    | "location"
    | "link"
    | "event";

/** 微信推送 XML 的扁平字段，未知字段会被完整保留。 */
export interface WechatIncomingMessage extends Record<string, unknown> {
    /** 完整原始 XML；嵌套事件字段无法扁平化时仍可无损处理。 */
    RawXml?: string;
    /** 安全模式收到的外层密文 XML。 */
    EncryptedXml?: string;
    ToUserName: string;
    FromUserName: string;
    CreateTime: number;
    MsgType: WechatMessageType | string;
    MsgId?: string;
    /** 模板/群发状态事件使用的消息 ID 字段。 */
    MsgID?: string;
    MsgDataId?: string;
    Idx?: string;
    Content?: string;
    MediaId?: string;
    PicUrl?: string;
    Format?: string;
    Recognition?: string;
    ThumbMediaId?: string;
    Location_X?: number;
    Location_Y?: number;
    Scale?: number;
    Label?: string;
    Title?: string;
    Description?: string;
    Url?: string;
    Event?: string;
    EventKey?: string;
    Ticket?: string;
    Latitude?: number;
    Longitude?: number;
    Precision?: number;
    Status?: string;
}

export interface WechatNamedEvent<TName extends string = string> extends WechatIncomingMessage {
    MsgType: "event";
    Event: TName;
}

/** WechatClient 对外事件表；精确微信 Event 可通过 onEvent() 订阅。 */
export interface WechatClientEvents {
    ready: [];
    stop: [];
    token_refreshed: [expiresIn: number];
    raw_event: [message: WechatIncomingMessage];
    message: [message: WechatIncomingMessage];
    event: [message: WechatIncomingMessage];
    [eventName: `event.${string}`]: [message: WechatIncomingMessage];
}

export interface WechatUser {
    subscribe: number;
    openid: string;
    nickname?: string;
    sex?: number;
    language?: string;
    city?: string;
    province?: string;
    country?: string;
    headimgurl?: string;
    subscribe_time?: number;
    unionid?: string;
    remark?: string;
    tagid_list?: number[];
    subscribe_scene?: string;
    qr_scene?: number;
    qr_scene_str?: string;
}

export interface WechatUserList {
    total: number;
    count: number;
    data?: { openid: string[] };
    next_openid: string;
}

export interface WechatTag {
    id: number;
    name: string;
    count?: number;
}

export interface WechatTemplateMessage extends Record<string, unknown> {
    touser: string;
    template_id: string;
    url?: string;
    miniprogram?: { appid: string; pagepath: string };
    data: Record<string, { value: string; color?: string }>;
}

export interface WechatOutboundMessage extends Record<string, unknown> {
    msgtype: string;
    text?: { content: string };
    image?: { media_id: string };
    voice?: { media_id: string };
    video?: { media_id: string; thumb_media_id?: string; title?: string; description?: string };
    music?: Record<string, unknown>;
    news?: { articles: WechatNewsArticle[] };
    wxcard?: { card_id: string };
    miniprogrampage?: Record<string, unknown>;
}

export interface WechatNewsArticle {
    title: string;
    description?: string;
    url?: string;
    picurl?: string;
}

export interface WechatApiCallOptions {
    method?: "GET" | "POST";
    path: string;
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: unknown;
    token?: boolean;
    responseType?: "json" | "buffer";
    signal?: AbortSignal;
}

export interface WechatWebhookRequest {
    method: "GET" | "POST";
    query: Readonly<Record<string, unknown>>;
    body?: string | Buffer;
}

export interface WechatWebhookResponse {
    status: number;
    body: unknown;
    contentType?: string;
}

export interface WechatIngressOptions {
    passiveReplyTimeoutMs?: number;
}
