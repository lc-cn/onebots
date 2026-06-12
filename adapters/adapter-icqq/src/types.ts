/**
 * ICQQ 适配器类型定义
 * 基于 @icqqjs/icqq 库
 */

// log4js Configuration type -- not importable directly, use unknown as passthrough
type Log4jsConfiguration = unknown;

// ============================================
// 配置类型
// ============================================

/**
 * 登录平台类型
 */
export enum Platform {
    /** 安卓手机 */
    Android = 1,
    /** 安卓平板 */
    AndroidPad = 2,
    /** 安卓手表 */
    AndroidWatch = 3,
    /** MacOS */
    MacOS = 4,
    /** iPad */
    iPad = 5,
    /** Tim */
    Tim = 6,
}

/**
 * ICQQ 协议配置
 */
export interface ICQQProtocol {
    /** 登录平台，默认 2 (安卓平板) */
    platform?: Platform;
    /** 登录 Apk 版本 */
    ver?: string;
    /** 签名服务器地址，未配置可能会导致登录失败和无法收发消息 */
    sign_api_addr?: string;
    /** 数据存储目录，默认 path.join(process.cwd(), "data") */
    data_dir?: string;
    /** log4js 配置 */
    log_config?: Log4jsConfiguration;
    /** 群聊和频道中过滤自己的消息，默认 true */
    ignore_self?: boolean;
    /** 被风控时是否尝试用分片发送，默认 true */
    resend?: boolean;
    /** 触发 system.offline.network 事件后的重新登录间隔秒数，默认 5 */
    reconn_interval?: number;
    /** 是否缓存群员列表，默认 true */
    cache_group_member?: boolean;
    /** 自动选择最优服务器，默认 true */
    auto_server?: boolean;
    /** ffmpeg 路径，需自行安装 ffmpeg */
    ffmpeg_path?: string;
    /** ffprobe 路径，需自行安装 ffmpeg */
    ffprobe_path?: string;
}

/**
 * ICQQ 适配器配置
 */
export interface ICQQConfig {
    /** 账号 ID (QQ 号) */
    account_id: string;
    /** QQ 密码 (可选，支持扫码登录) */
    password?: string;
    /** 协议配置 */
    protocol?: ICQQProtocol;
}

// ============================================
// 用户相关类型
// ============================================

/**
 * QQ 用户信息
 */
export interface ICQQUser {
    /** QQ 号 */
    user_id: number;
    /** 昵称 */
    nickname: string;
    /** 性别 */
    sex?: 'male' | 'female' | 'unknown';
    /** 年龄 */
    age?: number;
    /** 头像 URL */
    avatar?: string;
}

/**
 * 好友信息
 */
export interface ICQQFriend extends ICQQUser {
    /** 备注名 */
    remark?: string;
    /** 分组 ID */
    class_id?: number;
}

// ============================================
// 群组相关类型
// ============================================

/**
 * 群信息
 */
export interface ICQQGroup {
    /** 群号 */
    group_id: number;
    /** 群名 */
    group_name: string;
    /** 群主 QQ */
    owner_id?: number;
    /** 管理员列表 */
    admin_list?: number[];
    /** 成员数量 */
    member_count?: number;
    /** 最大成员数 */
    max_member_count?: number;
}

/**
 * 群成员信息
 */
export interface ICQQGroupMember {
    /** 群号 */
    group_id: number;
    /** QQ 号 */
    user_id: number;
    /** 昵称 */
    nickname: string;
    /** 群名片 */
    card?: string;
    /** 性别 */
    sex?: 'male' | 'female' | 'unknown';
    /** 年龄 */
    age?: number;
    /** 加群时间 */
    join_time?: number;
    /** 最后发言时间 */
    last_sent_time?: number;
    /** 等级 */
    level?: number;
    /** 角色 */
    role?: 'owner' | 'admin' | 'member';
    /** 专属头衔 */
    title?: string;
    /** 头衔过期时间 */
    title_expire_time?: number;
    /** 是否被禁言 */
    shutup_time?: number;
}

// ============================================
// 消息相关类型
// ============================================

/**
 * 消息发送返回值
 */
export interface ICQQMessageRet {
    /** 消息 ID */
    message_id: string;
    /** 消息序号 */
    seq: number;
    /** 随机数 */
    rand: number;
    /** 发送时间 */
    time: number;
}

/**
 * 消息段类型
 */
export type ICQQMessageElement =
    | { type: 'text'; text: string }
    | { type: 'face' | 'sface'; id: number }
    | { type: 'image'; file: string; url?: string }
    | { type: 'record'; file: string; url?: string }
    | { type: 'video'; file: string; url?: string }
    | { type: 'at'; qq: number | 'all' }
    | { type: 'share'; url: string; title: string; content?: string; image?: string }
    | { type: 'json'; data: string }
    | { type: 'xml'; data: string }
    | { type: 'poke'; id: number }
    | { type: 'reply'; id: string };

/**
 * 私聊消息事件
 */
export interface ICQQPrivateMessageEvent {
    /** 消息 ID */
    message_id: string;
    /** 发送者 QQ */
    user_id: number;
    /** 消息内容 */
    message: ICQQMessageElement[];
    /** 原始消息 */
    raw_message: string;
    /** 发送时间戳 */
    time: number;
    /** 发送者信息 */
    sender: {
        user_id: number;
        nickname: string;
        sex?: 'male' | 'female' | 'unknown';
        age?: number;
    };
    /** 自动回复函数 */
    reply?: (message: string | ICQQMessageElement[], quote?: boolean) => Promise<ICQQMessageRet>;
}

/**
 * 群消息事件
 */
export interface ICQQGroupMessageEvent {
    /** 消息 ID */
    message_id: string;
    /** 群号 */
    group_id: number;
    /** 发送者 QQ */
    user_id: number;
    /** 消息内容 */
    message: ICQQMessageElement[];
    /** 原始消息 */
    raw_message: string;
    /** 发送时间戳 */
    time: number;
    /** 发送者信息 */
    sender: {
        user_id: number;
        nickname: string;
        card?: string;
        sex?: 'male' | 'female' | 'unknown';
        age?: number;
        role?: 'owner' | 'admin' | 'member';
        title?: string;
    };
    /** 群信息 */
    group: {
        group_id: number;
        group_name: string;
    };
    /** @提及的 QQ 列表 */
    atme?: boolean;
    /** 自动回复函数 */
    reply?: (message: string | ICQQMessageElement[], quote?: boolean) => Promise<ICQQMessageRet>;
}

// ============================================
// 通知事件类型
// ============================================

/**
 * 好友申请事件
 */
export interface ICQQFriendRequestEvent {
    /** 请求 ID */
    request_id: string;
    /** 申请人 QQ */
    user_id: number;
    /** 申请人昵称 */
    nickname: string;
    /** 验证信息 */
    comment: string;
    /** 来源 */
    source: string;
    /** 时间戳 */
    time: number;
}

/**
 * 群申请/邀请事件
 */
export interface ICQQGroupRequestEvent {
    /** 请求 ID */
    request_id: string;
    /** 群号 */
    group_id: number;
    /** 申请人/邀请人 QQ */
    user_id: number;
    /** 昵称 */
    nickname: string;
    /** 请求类型 */
    sub_type: 'add' | 'invite';
    /** 验证信息 */
    comment: string;
    /** 时间戳 */
    time: number;
}

/**
 * 群成员增加事件
 */
export interface ICQQGroupIncreaseEvent {
    /** 群号 */
    group_id: number;
    /** 新成员 QQ */
    user_id: number;
    /** 操作者 QQ (邀请人) */
    operator_id?: number;
    /** 时间戳 */
    time: number;
}

/**
 * 群成员减少事件
 */
export interface ICQQGroupDecreaseEvent {
    /** 群号 */
    group_id: number;
    /** 离开的成员 QQ */
    user_id: number;
    /** 操作者 QQ (踢人者) */
    operator_id?: number;
    /** 类型: leave 退群, kick 被踢 */
    sub_type: 'leave' | 'kick' | 'kick_me';
    /** 时间戳 */
    time: number;
}

/**
 * 群禁言事件
 */
export interface ICQQGroupMuteEvent {
    /** 群号 */
    group_id: number;
    /** 被禁言的 QQ (0 表示全员禁言) */
    user_id: number;
    /** 操作者 QQ */
    operator_id: number;
    /** 禁言时长 (秒，0 表示解除禁言) */
    duration: number;
    /** 时间戳 */
    time: number;
}

/**
 * 群管理员变动事件
 */
export interface ICQQGroupAdminEvent {
    /** 群号 */
    group_id: number;
    /** QQ 号 */
    user_id: number;
    /** 类型: set 设置管理员, unset 取消管理员 */
    sub_type: 'set' | 'unset';
    /** 时间戳 */
    time: number;
}

/**
 * 好友消息撤回事件
 */
export interface ICQQFriendRecallEvent {
    /** 消息 ID */
    message_id: string;
    /** 好友 QQ */
    user_id: number;
    /** 时间戳 */
    time: number;
}

/**
 * 群消息撤回事件
 */
export interface ICQQGroupRecallEvent {
    /** 消息 ID */
    message_id: string;
    /** 群号 */
    group_id: number;
    /** 消息发送者 QQ */
    user_id: number;
    /** 操作者 QQ */
    operator_id: number;
    /** 时间戳 */
    time: number;
}

/**
 * 戳一戳事件
 */
export interface ICQQPokeEvent {
    /** 群号 (私聊时为 0) */
    group_id?: number;
    /** 操作者 QQ */
    operator_id: number;
    /** 被戳者 QQ */
    target_id: number;
    /** 动作 */
    action: string;
    /** 后缀 */
    suffix: string;
    /** 时间戳 */
    time: number;
}

// ============================================
// 系统事件类型
// ============================================

/**
 * 登录事件
 */
export interface ICQQLoginEvent {
    /** QQ 号 */
    uin: number;
}

/**
 * 上线事件
 */
export interface ICQQOnlineEvent {
    /** QQ 号 */
    uin: number;
}

/**
 * 离线事件
 */
export interface ICQQOfflineEvent {
    /** QQ 号 */
    uin: number;
    /** 原因 */
    message: string;
}

/**
 * 滑块验证码事件
 */
export interface ICQQSliderEvent {
    /** 验证码 URL */
    url: string;
}

/**
 * 设备锁验证事件
 */
export interface ICQQDeviceEvent {
    /** 验证码 URL */
    url: string;
    /** 手机号 */
    phone: string;
}

/**
 * 登录错误事件
 */
export interface ICQQLoginErrorEvent {
    /** 错误码 */
    code: number;
    /** 错误消息 */
    message: string;
}

/**
 * 二维码事件
 */
export interface ICQQQRCodeEvent {
    /** 二维码图片 Buffer */
    image: Buffer;
}

