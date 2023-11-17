
// 心跳参数
export enum OpCode {
    DISPATCH = 0, // 服务端进行消息推送
    HEARTBEAT = 1, // 客户端发送心跳
    IDENTIFY = 2, // 鉴权
    RESUME = 6, // 恢复连接
    RECONNECT = 7, // 服务端通知客户端重连
    INVALID_SESSION = 9, // 当identify或resume的时候，如果参数有错，服务端会返回该消息
    HELLO = 10, // 当客户端与网关建立ws连接之后，网关下发的第一条消息
    HEARTBEAT_ACK = 11, // 当发送心跳成功之后，就会收到该消息
}

export const SessionEvents = {
    CLOSED: "CLOSED",
    READY: "READY", // 已经可以通信
    ERROR: "ERROR", // 会话错误
    INVALID_SESSION: "INVALID_SESSION",
    RECONNECT: "RECONNECT", // 服务端通知重新连接
    DISCONNECT: "DISCONNECT", // 断线
    EVENT_WS: "EVENT_WS", // 内部通信
    RESUMED: "RESUMED", // 重连
    DEAD: "DEAD" // 连接已死亡，请检查网络或重启
};
// websocket错误原因
export const WebsocketCloseReason = [
    {
        code: 4001,
        reason: "无效的opcode"
    },
    {
        code: 4002,
        reason: "无效的payload"
    },
    {
        code: 4007,
        reason: "seq错误"
    },
    {
        code: 4008,
        reason: "发送 payload 过快，请重新连接，并遵守连接后返回的频控信息",
        resume: true
    },
    {
        code: 4009,
        reason: "连接过期，请重连",
        resume: true
    },
    {
        code: 4010,
        reason: "无效的shard"
    },
    {
        code: 4011,
        reason: "连接需要处理的guild过多，请进行合理分片"
    },
    {
        code: 4012,
        reason: "无效的version"
    },
    {
        code: 4013,
        reason: "无效的intent"
    },
    {
        code: 4014,
        reason: "intent无权限"
    },
    {
        code: 4900,
        reason: "内部错误，请重连"
    },
    {
        code: 4914,
        reason: "机器人已下架,只允许连接沙箱环境,请断开连接,检验当前连接环境"
    },
    {
        code: 4915,
        reason: "机器人已封禁,不允许连接,请断开连接,申请解封后再连接"
    }
];

export enum Intends {
    GUILDS = 1 << 0, // 频道操作事件
    GUILD_MEMBERS = 1 << 1, // 频道成员变更事件
    GUILD_MESSAGES = 1 << 9, // 私域频道消息事件
    GUILD_MESSAGE_REACTIONS = 1 << 10, // 频道消息表态事件
    DIRECT_MESSAGE = 1 << 12, // 频道私信事件
    OPEN_FORUMS_EVENTS = 1 << 18,
    AUDIO_OR_LIVE_CHANNEL_MEMBERS = 1 << 19, // 音频或直播频道成员
    // GROUP_MESSAGE_CREATE = 1 << 24, // 群聊消息事件
    C2C_MESSAGE_CREATE = 1 << 25, // 私聊消息事件
    GROUP_AT_MESSAGE_CREATE = 1 << 25, // 群聊@消息事件
    INTERACTION = 1 << 26, // 互动事件
    MESSAGE_AUDIT = 1 << 27, // 消息审核事件
    FORUMS_EVENTS = 1 << 28, // 论坛事件(仅私域)
    AUDIO_ACTIONS = 1 << 29, // 音频操作事件
    PUBLIC_GUILD_MESSAGES = 1 << 30,// 公域机器人消息事件
}
export enum ChannelType {
    Content = 0, // 文本频道
    Record = 2, // 语音频道
    ChannelGroup = 4, // 频道分组
    Live = 10005, // 直播频道
    App = 10006, // 应用频道
    Forms = 10007, // 论坛频道
}
export enum ChannelSubType {
    Chat = 0, // 闲聊
    Announces = 1, // 公告
    Strategy = 2, // 攻略
    Black = 3, // 开黑
}
export enum PrivateType {
    Public = 0, // 公开
    Admin = 1, // 频道主和管理员
    Some = 2, // 频道主、管理员以及指定成员
}
export enum SpeakPermission {
    All = 1,// 所有人
    Some = 2,// 频道主、管理员以及指定成员
}
