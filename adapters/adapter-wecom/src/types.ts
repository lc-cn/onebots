/**
 * 企业微信开放平台 API 类型定义
 * 基于企业微信开放平台官方 API
 */

// 配置类型
export interface WeComConfig {
    account_id: string;
    corp_id: string;           // 企业 ID
    corp_secret: string;        // 应用 Secret
    agent_id: string;           // 应用 AgentId
    token?: string;             // 回调验证 Token（可选）
    encoding_aes_key?: string;  // 消息加解密密钥（可选）
}

// 企业微信用户类型
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

/**
 * 企业微信用户扩展属性
 */
export interface WeComExtAttr {
    attrs?: Array<{
        type: number;
        name: string;
        text?: { value: string };
        web?: { url: string; title: string };
    }>;
}

/**
 * 企业微信用户外部资料
 */
export interface WeComExternalProfile {
    external_corp_name?: string;
    external_attr?: WeComExtAttr;
    wechat_channels?: {
        nickname?: string;
        status?: number;
    };
}

// 企业微信部门类型
export interface WeComDepartment {
    id: number;
    name: string;
    name_en?: string;
    parentid?: number;
    order?: number;
}

// 企业微信消息类型
export interface WeComMessage {
    msgid: string;
    action: string;
    from: {
        type: string;
        id: string;
    };
    tolist: string[];
    roomid?: string;
    msgtime: number;
    msgtype: string;
    text?: {
        content: string;
    };
    image?: {
        md5: string;
        filesize: number;
        sdkfileid: string;
    };
    voice?: {
        md5: string;
        voice_size: number;
        play_length: number;
        sdkfileid: string;
    };
    video?: {
        md5: string;
        filesize: number;
        play_length: number;
        sdkfileid: string;
    };
    file?: {
        md5: string;
        filename: string;
        filesize: number;
        sdkfileid: string;
    };
    /** 扩展字段 */
    location?: string;
    button?: Array<{ type: string; name: string; value?: string }>;
}

// 企业微信事件类型
export interface WeComEvent {
    EventType: string;
    EventId: string;
    TimeStamp: number;
    FromUserName?: string;
    ToUserName?: string;
    AgentID?: string;
}

/**
 * 企业微信通讯录变更事件
 */
export interface WeComChangeEvent extends WeComEvent {
    EventType: 'change_contact';
    ChangeType: 'create_user' | 'update_user' | 'delete_user';
    UserID: string;
}

// 访问令牌响应
export interface WeComTokenResponse {
    errcode: number;
    errmsg: string;
    access_token?: string;
    expires_in?: number;
}

// 发送消息请求
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

// 发送消息响应
export interface WeComSendMessageResponse {
    errcode: number;
    errmsg: string;
    invaliduser?: string;
    invalidparty?: string;
    invalidtag?: string;
    msgid?: string;
    response_code?: string;
}

// API 基础响应
export interface WeComAPIResponse {
    errcode: number;
    errmsg: string;
}

// 获取用户信息响应
export interface WeComUserResponse extends WeComAPIResponse {
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
    external_position?: string;
    external_profile?: WeComExternalProfile;
}

// 获取部门列表响应
export interface WeComDepartmentListResponse extends WeComAPIResponse {
    department?: WeComDepartment[];
}

// 获取部门成员列表响应
export interface WeComDepartmentMembersResponse extends WeComAPIResponse {
    userlist?: WeComUser[];
}

