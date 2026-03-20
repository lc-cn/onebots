/**
 * 微信客服适配器配置与 API 相关类型（字段名对齐企业微信文档）
 */
export interface WeComKfConfig {
    account_id: string;
    /** 企业 ID，用于回调解密校验 receiveid（可选但推荐） */
    corp_id: string;
    /** 已在管理后台授权「微信客服」API 的自建应用 Secret */
    corp_secret: string;
    /** 微信客服 / 接收消息 配置的 Token */
    token: string;
    /** EncodingAESKey */
    encoding_aes_key: string;
    /**
     * 默认客服账号 open_kfid；回调中的 OpenKfId 优先生效。
     * 发送消息时若未从会话上下文推断，则使用该值。
     */
    open_kfid?: string;
    /**
     * 上传临时素材使用的应用 agentid（发送图片/语音等时需要 media_id）
     * 参见 https://developer.work.weixin.qq.com/document/path/90253
     */
    agent_id?: string;
    /** 为 true 时定时调用 sync_msg（无 token，易受频率限制，默认 false） */
    enable_sync_poll?: boolean;
    /** 轮询间隔（毫秒），默认 30000 */
    sync_poll_interval_ms?: number;
    /** sync_msg 游标持久化文件路径（JSON）；不填则仅内存 */
    cursor_store_path?: string;
}

export interface WeComTokenResponse {
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
}

export interface KfSyncMsgRequest {
    cursor?: string;
    token?: string;
    limit?: number;
    voice_format?: number;
    open_kfid: string;
}

export interface KfMsgItem {
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
    miniprogram?: { appid?: string; title?: string; pagepath?: string; thumb_media_id?: string };
    event?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface KfSyncMsgResponse {
    errcode: number;
    errmsg: string;
    next_cursor?: string;
    has_more?: number;
    msg_list?: KfMsgItem[];
}

export interface KfSendMsgResponse {
    errcode: number;
    errmsg: string;
    msgid?: string;
}

export interface KfCustomerBatchGetResponse {
    errcode: number;
    errmsg: string;
    customer_list?: Array<{
        external_userid: string;
        nickname?: string;
        avatar?: string;
        gender?: number;
        unionid?: string;
    }>;
    invalid_external_userid?: string[];
}

export interface KfServiceStateGetResponse {
    errcode: number;
    errmsg: string;
    service_state?: number;
    servicer_userid?: string;
}
