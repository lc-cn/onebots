/** 企业微信自建应用官方 API 类型。 */
export interface WeComConfig {
    account_id: string;
    corp_id: string;
    corp_secret: string;
    agent_id: string;
    token: string;
    encoding_aes_key: string;
    webhook_path?: string;
    deduplicate_webhooks?: boolean;
    webhook_deduplication_limit?: number;
    api_base_url?: string;
}

export interface WeComUser {
    userid: string;
    name: string;
    alias?: string;
    mobile?: string;
    department?: number[];
    order?: number[];
    position?: string;
    gender?: string;
    email?: string;
    avatar?: string;
    status?: number;
    is_leader_in_dept?: number[];
    telephone?: string;
    address?: string;
    extattr?: WeComExtAttr;
    to_invite?: boolean;
    external_position?: string;
    external_profile?: WeComExternalProfile;
}

export interface WeComExtAttr {
    attrs?: Array<{
        type: number;
        name: string;
        text?: { value: string };
        web?: { url: string; title: string };
    }>;
}

export interface WeComExternalProfile {
    external_corp_name?: string;
    external_attr?: WeComExtAttr;
    wechat_channels?: {
        nickname?: string;
        status?: number;
    };
}

export interface WeComDepartment {
    id: number;
    name: string;
    name_en?: string;
    parentid?: number;
    order?: number;
}

/** 解密后的企业微信接收消息或事件。未枚举字段仍完整保留。 */
export interface WeComEvent extends Record<string, unknown> {
    RawXml?: string;
    EncryptedXml?: string;
    MsgType?: string;
    MsgId?: string;
    CreateTime?: number;
    Event?: string;
    EventKey?: string;
    ChangeType?: string;
    FromUserName?: string;
    ToUserName?: string;
    AgentID?: string;
    Content?: string;
    PicUrl?: string;
    MediaId?: string;
    Format?: string;
    Recognition?: string;
    Location_X?: number;
    Location_Y?: number;
    Scale?: number;
    Label?: string;
    Title?: string;
    Description?: string;
    Url?: string;
    UserID?: string;
    TaskId?: string;
    ResponseCode?: string;
}

export interface WeComAgent extends WeComAPIResponse {
    agentid: number;
    name?: string;
    square_logo_url?: string;
    description?: string;
    allow_userinfos?: { user?: Array<{ userid: string }> };
    allow_partys?: { partyid?: number[] };
    allow_tags?: { tagid?: number[] };
    close?: number;
    redirect_domain?: string;
    report_location_flag?: number;
    isreportenter?: number;
    home_url?: string;
}

export interface WeComAppChat {
    chatid: string;
    name?: string;
    owner?: string;
    userlist: string[];
}

export interface WeComCallOptions {
    method?: "GET" | "POST";
    path: string;
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    body?: unknown;
    token?: boolean;
    response_type?: "json" | "buffer";
    signal?: AbortSignal;
}

export interface WeComWebhookRequest {
    method: "GET" | "POST";
    query: Readonly<Record<string, unknown>>;
    body?: string | Buffer;
}

export interface WeComWebhookResponse {
    status: number;
    body: unknown;
    contentType?: string;
}

export interface WeComChangeEvent extends WeComEvent {
    MsgType: "event";
    Event: "change_contact";
    ChangeType: "create_user" | "update_user" | "delete_user";
    UserID: string;
}

export interface WeComTokenResponse {
    errcode: number;
    errmsg: string;
    access_token?: string;
    expires_in?: number;
}

export interface WeComSendMessageRequest {
    touser?: string;
    toparty?: string;
    totag?: string;
    msgtype: string;
    agentid: number;
    text?: {
        content: string;
    };
    image?: {
        media_id: string;
    };
    voice?: {
        media_id: string;
    };
    video?: {
        media_id: string;
        title?: string;
        description?: string;
    };
    file?: {
        media_id: string;
    };
    textcard?: {
        title: string;
        description: string;
        url: string;
        btntxt?: string;
    };
    news?: {
        articles: Array<{
            title: string;
            description?: string;
            url: string;
            picurl?: string;
        }>;
    };
    mpnews?: {
        articles: Array<{
            title: string;
            thumb_media_id: string;
            author?: string;
            content_source_url?: string;
            content: string;
            digest?: string;
        }>;
    };
    markdown?: {
        content: string;
    };
}

export interface WeComSendMessageResponse {
    errcode: number;
    errmsg: string;
    invaliduser?: string;
    invalidparty?: string;
    invalidtag?: string;
    msgid?: string;
    response_code?: string;
}

export interface WeComAPIResponse {
    errcode: number;
    errmsg: string;
}

export interface WeComDepartmentMembersResponse extends WeComAPIResponse {
    userlist?: WeComUser[];
}
