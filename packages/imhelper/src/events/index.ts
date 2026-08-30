/**
 * 事件类型导出
 */

// 基础事件
export * from "./base.js";

// 消息事件
export * from "./message/index.js";

// 通知事件
export * from "./notice/index.js";

// 请求事件
export * from "./request/index.js";

// 元事件
export * from "./meta/index.js";

// 事件工厂
export * from "./factory.js";

// 事件工具函数
export * from "./utils.js";

/**
 * 所有消息事件类型的联合
 */
export type AnyMessageEvent<Id extends string | number = string | number> =
    | import("./message/private.js").PrivateMessageEvent<Id>
    | import("./message/group.js").GroupMessageEvent<Id>
    | import("./message/channel.js").ChannelMessageEvent<Id>;

/** Adapter 与 ImHelper 之间传递的纯消息数据联合。 */
export type AnyMessageEventData<Id extends string | number = string | number> =
    | import("./message/private.js").PrivateMessageEvent.Data<Id>
    | import("./message/group.js").GroupMessageEvent.Data<Id>
    | import("./message/channel.js").ChannelMessageEvent.Data<Id>;

/**
 * 所有通知事件类型的联合
 */
export type AnyNoticeEvent<Id extends string | number = string | number> =
    | import("./notice/group-member-increase.js").GroupMemberIncreaseNoticeEvent<Id>
    | import("./notice/group-member-decrease.js").GroupMemberDecreaseNoticeEvent<Id>
    | import("./notice/group-message-delete.js").GroupMessageDeleteNoticeEvent<Id>
    | import("./notice/channel-message-delete.js").ChannelMessageDeleteNoticeEvent<Id>
    | import("./notice/private-message-delete.js").PrivateMessageDeleteNoticeEvent<Id>
    | import("./notice/friend-increase.js").FriendIncreaseNoticeEvent<Id>
    | import("./notice/friend-decrease.js").FriendDecreaseNoticeEvent<Id>;

/**
 * 所有请求事件类型的联合
 */
export type AnyRequestEvent<Id extends string | number = string | number> =
    | import("./request/friend.js").FriendRequestEvent<Id>
    | import("./request/group.js").GroupRequestEvent<Id>;

/**
 * 所有元事件类型的联合
 */
export type AnyMetaEvent<Id extends string | number = string | number> =
    | import("./meta/lifecycle.js").LifecycleMetaEvent<Id>
    | import("./meta/heartbeat.js").HeartbeatMetaEvent<Id>
    | import("./meta/status-update.js").StatusUpdateMetaEvent<Id>;

/**
 * 所有事件类型的联合
 */
export type Event<Id extends string | number = string | number> =
    | AnyMessageEvent<Id>
    | AnyNoticeEvent<Id>
    | AnyRequestEvent<Id>
    | AnyMetaEvent<Id>;
