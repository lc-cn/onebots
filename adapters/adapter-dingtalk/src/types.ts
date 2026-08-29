/** 钉钉事件接收方式。 */
export type DingTalkReceiveMode = "stream" | "webhook" | "manual";

/** 钉钉适配器配置。发送能力与接收方式相互独立。 */
export interface DingTalkConfig {
    account_id: string;
    app_key?: string;
    app_secret?: string;
    agent_id?: string;
    /** 企业机器人编码；未设置时使用 app_key。 */
    robot_code?: string;
    corp_id?: string;
    receive_mode?: DingTalkReceiveMode;
    /** Stream EVENT 并发处理上限；达到上限时 SDK 返回 LATER。 */
    max_pending_event_handlers?: number;
    /** Stream CALLBACK 并发处理上限；达到上限时等待服务端重投。 */
    max_pending_callback_handlers?: number;
    /** HTTP 回调加密 AES Key（43 字符）。 */
    encrypt_key?: string;
    /** HTTP 回调签名 Token。 */
    token?: string;
    /** 自定义群机器人发送地址，不参与接收模式判断。 */
    webhook_url?: string;
    /** 自定义群机器人加签密钥。 */
    webhook_secret?: string;
}

export interface DingTalkApiRequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean>;
    /** 现代 API 使用请求头鉴权，旧版 oapi 使用 query 鉴权。 */
    auth?: "modern" | "legacy" | "none";
}

export interface DingTalkUser {
    userid: string;
    unionid?: string;
    name: string;
    avatar?: string;
    mobile?: string;
    email?: string;
    dept_id_list?: number[];
    title?: string;
    admin?: boolean;
    boss?: boolean;
}

export interface DingTalkRobotMessage extends Record<string, unknown> {
    conversationId: string;
    conversationType: "1" | "2" | string;
    conversationTitle?: string;
    chatbotCorpId?: string;
    chatbotUserId?: string;
    msgId: string;
    msgtype: string;
    createAt: number;
    senderId: string;
    senderStaffId?: string;
    senderNick?: string;
    senderCorpId?: string;
    sessionWebhook?: string;
    sessionWebhookExpiredTime?: number;
    robotCode?: string;
    isAdmin?: boolean;
    text?: { content?: string };
    richText?: Record<string, unknown>;
    content?: Record<string, unknown>;
    atUsers?: Array<{ dingtalkId?: string; staffId?: string }>;
}

/** 统一后的钉钉原生事件；raw 始终保留完整载荷。 */
export interface DingTalkEvent {
    eventType: string;
    eventId: string;
    eventTime: number;
    eventCorpId?: string;
    eventData: Record<string, unknown>;
    raw: Record<string, unknown>;
}

export interface DingTalkTokenResponse {
    accessToken?: string;
    expireIn?: number;
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
}

export interface DingTalkUserGetResponse {
    errcode: number;
    errmsg: string;
    result: DingTalkUser;
}

export interface DingTalkDepartmentUserResponse {
    errcode: number;
    errmsg: string;
    result?: {
        has_more?: boolean;
        next_cursor?: number;
        list?: DingTalkUser[];
    };
}

export interface DingTalkDepartment {
    dept_id: number;
    name?: string;
    parent_id?: number;
}

export interface DingTalkDepartmentListResponse {
    errcode: number;
    errmsg: string;
    result?: DingTalkDepartment[];
}

export interface DingTalkSceneGroupMember {
    userId: string;
    nickname?: string;
}

export interface DingTalkSceneGroupMemberResponse {
    result?: {
        member_user_ids?: string[];
        next_cursor?: string;
        has_more?: boolean;
        staff_id_nick_map?: Record<string, string> | string;
    };
}

export interface DingTalkSendResult {
    processQueryKey?: string;
    task_id?: string;
    request_id?: string;
    errcode?: number;
    errmsg?: string;
}

export interface DingTalkWebhookMessage {
    msgtype: string;
    text?: { content: string };
    markdown?: { title: string; text: string };
    link?: { title: string; text: string; messageUrl: string; picUrl?: string };
    actionCard?: Record<string, unknown>;
    at?: { atMobiles?: string[]; atUserIds?: string[]; isAtAll?: boolean };
}

export interface DingTalkWebhookResponse {
    errcode: number;
    errmsg: string;
}
