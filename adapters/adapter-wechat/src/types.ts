/**
 * 微信公众号 API 类型定义
 */

// 账号类型
export type WechatAccountType = 'subscription' | 'service';

// 配置类型
export interface WechatConfig {
    account_id: string;
    appId: string;
    appSecret: string;
    token: string;
    encodingAESKey?: string;
    accountType?: WechatAccountType; // 账号类型，默认 subscription
}

// 消息类型
export type WechatMessageType = 'text' | 'image' | 'voice' | 'video' | 'music' | 'news' | 'mpnews' | 'msgmenu' | 'wxcard' | 'miniprogrampage' | 'event';

// 事件类型
export type WechatEventType = 'subscribe' | 'unsubscribe' | 'SCAN' | 'LOCATION' | 'CLICK' | 'VIEW';

// 用户信息
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
    groupid?: number;
    tagid_list?: number[];
    subscribe_scene?: string;
    qr_scene?: number;
    qr_scene_str?: string;
}

// 用户列表
export interface WechatUserList {
    total: number;
    count: number;
    data: {
        openid: string[];
    };
    next_openid: string;
}

// 用户标签
export interface WechatTag {
    id: number;
    name: string;
    count?: number;
}

// 用户分组（已废弃，但保留兼容）
export interface WechatGroup {
    id: number;
    name: string;
    count?: number;
}

// 消息内容
export interface WechatTextMessage {
    content: string;
}

export interface WechatImageMessage {
    media_id: string;
}

export interface WechatVoiceMessage {
    media_id: string;
}

export interface WechatVideoMessage {
    media_id: string;
    thumb_media_id?: string;
    title?: string;
    description?: string;
}

export interface WechatNewsArticle {
    title: string;
    description?: string;
    url: string;
    picurl?: string;
}

export interface WechatNewsMessage {
    articles: WechatNewsArticle[];
}

// 模板消息
export interface WechatTemplateMessage {
    touser: string;
    template_id: string;
    url?: string;
    miniprogram?: {
        appid: string;
        pagepath: string;
    };
    data: Record<string, {
        value: string;
        color?: string;
    }>;
}

// 素材
export interface WechatMedia {
    type: 'image' | 'voice' | 'video' | 'thumb';
    media_id: string;
    created_at: number;
}

// Access Token
export interface WechatAccessToken {
    access_token: string;
    expires_in: number;
}

// API 响应
export interface WechatApiResponse<T = any> {
    errcode?: number;
    errmsg?: string;
    data?: T;
}

// 接收到的消息
export interface WechatIncomingMessage {
    ToUserName: string;
    FromUserName: string;
    CreateTime: number;
    MsgType: WechatMessageType;
    MsgId?: string;
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
    Event?: WechatEventType;
    EventKey?: string;
    Ticket?: string;
    Latitude?: number;
    Longitude?: number;
    Precision?: number;
}
