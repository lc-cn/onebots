import type { ImHelper } from "../imhelper.js";
import type { EventMap } from "../types.js";
import type { BaseEvent } from "./base.js";
import { ChannelMessageEvent } from "./message/channel.js";
import { GroupMessageEvent } from "./message/group.js";
import { PrivateMessageEvent } from "./message/private.js";
import { HeartbeatMetaEvent } from "./meta/heartbeat.js";
import { LifecycleMetaEvent } from "./meta/lifecycle.js";
import { StatusUpdateMetaEvent } from "./meta/status-update.js";
import { FriendDecreaseNoticeEvent } from "./notice/friend-decrease.js";
import { FriendIncreaseNoticeEvent } from "./notice/friend-increase.js";
import { GroupMemberDecreaseNoticeEvent } from "./notice/group-member-decrease.js";
import { GroupMemberIncreaseNoticeEvent } from "./notice/group-member-increase.js";
import { GroupMessageDeleteNoticeEvent } from "./notice/group-message-delete.js";
import { ChannelMessageDeleteNoticeEvent } from "./notice/channel-message-delete.js";
import { PrivateMessageDeleteNoticeEvent } from "./notice/private-message-delete.js";
import { FriendRequestEvent } from "./request/friend.js";
import { GroupRequestEvent } from "./request/group.js";

type EventTypeMap<Id extends string | number> = {
    "message.private": PrivateMessageEvent<Id>;
    "message.group": GroupMessageEvent<Id>;
    "message.channel": ChannelMessageEvent<Id>;
    "notice.group_member_increase": GroupMemberIncreaseNoticeEvent<Id>;
    "notice.group_member_decrease": GroupMemberDecreaseNoticeEvent<Id>;
    "notice.group_message_delete": GroupMessageDeleteNoticeEvent<Id>;
    "notice.channel_message_delete": ChannelMessageDeleteNoticeEvent<Id>;
    "notice.private_message_delete": PrivateMessageDeleteNoticeEvent<Id>;
    "notice.friend_increase": FriendIncreaseNoticeEvent<Id>;
    "notice.friend_decrease": FriendDecreaseNoticeEvent<Id>;
    "request.friend": FriendRequestEvent<Id>;
    "request.group": GroupRequestEvent<Id>;
    "meta.lifecycle": LifecycleMetaEvent<Id>;
    "meta.heartbeat": HeartbeatMetaEvent<Id>;
    "meta.status_update": StatusUpdateMetaEvent<Id>;
};

type EventDataMap<Id extends string | number> = {
    "message.private": PrivateMessageEvent.Data<Id>;
    "message.group": GroupMessageEvent.Data<Id>;
    "message.channel": ChannelMessageEvent.Data<Id>;
    "notice.group_member_increase": GroupMemberIncreaseNoticeEvent.Data<Id>;
    "notice.group_member_decrease": GroupMemberDecreaseNoticeEvent.Data<Id>;
    "notice.group_message_delete": GroupMessageDeleteNoticeEvent.Data<Id>;
    "notice.channel_message_delete": ChannelMessageDeleteNoticeEvent.Data<Id>;
    "notice.private_message_delete": PrivateMessageDeleteNoticeEvent.Data<Id>;
    "notice.friend_increase": FriendIncreaseNoticeEvent.Data<Id>;
    "notice.friend_decrease": FriendDecreaseNoticeEvent.Data<Id>;
    "request.friend": FriendRequestEvent.Data<Id>;
    "request.group": GroupRequestEvent.Data<Id>;
    "meta.lifecycle": LifecycleMetaEvent.Data<Id>;
    "meta.heartbeat": HeartbeatMetaEvent.Data<Id>;
    "meta.status_update": StatusUpdateMetaEvent.Data<Id>;
};

type SupportedEventType = keyof EventTypeMap<string | number>;
type EventInput<Id extends string | number> = {
    [Type in keyof EventTypeMap<Id>]: { type: Type; data: EventDataMap<Id>[Type] };
}[keyof EventTypeMap<Id>];

const supportedEventTypes = [
    "message.private",
    "message.group",
    "message.channel",
    "notice.group_member_increase",
    "notice.group_member_decrease",
    "notice.group_message_delete",
    "notice.channel_message_delete",
    "notice.private_message_delete",
    "notice.friend_increase",
    "notice.friend_decrease",
    "request.friend",
    "request.group",
    "meta.lifecycle",
    "meta.heartbeat",
    "meta.status_update",
] as const satisfies readonly SupportedEventType[];

function assertEventData(type: string, data: unknown): asserts data is { timestamp: number } {
    if (typeof data !== "object" || data === null) {
        throw new TypeError(`事件 ${type} 的数据必须是对象`);
    }
    if (!("timestamp" in data) || typeof data.timestamp !== "number") {
        throw new TypeError(`事件 ${type} 缺少有效的 timestamp`);
    }
}

function createKnownEvent<Id extends string | number>(
    type: keyof EventTypeMap<Id>,
    data: EventDataMap<Id>[keyof EventDataMap<Id>],
    helper: ImHelper<Id>,
): BaseEvent<Id> {
    assertEventData(type, data);

    // TypeScript 无法根据运行时 key 收窄关联的映射值；断言被限制在唯一的构造分派点。
    switch (type) {
        case "message.private":
            return new PrivateMessageEvent(helper, data as PrivateMessageEvent.Data<Id>);
        case "message.group":
            return new GroupMessageEvent(helper, data as GroupMessageEvent.Data<Id>);
        case "message.channel":
            return new ChannelMessageEvent(helper, data as ChannelMessageEvent.Data<Id>);
        case "notice.group_member_increase":
            return new GroupMemberIncreaseNoticeEvent(
                helper,
                data as GroupMemberIncreaseNoticeEvent.Data<Id>,
            );
        case "notice.group_member_decrease":
            return new GroupMemberDecreaseNoticeEvent(
                helper,
                data as GroupMemberDecreaseNoticeEvent.Data<Id>,
            );
        case "notice.group_message_delete":
            return new GroupMessageDeleteNoticeEvent(
                helper,
                data as GroupMessageDeleteNoticeEvent.Data<Id>,
            );
        case "notice.channel_message_delete":
            return new ChannelMessageDeleteNoticeEvent(
                helper,
                data as ChannelMessageDeleteNoticeEvent.Data<Id>,
            );
        case "notice.private_message_delete":
            return new PrivateMessageDeleteNoticeEvent(
                helper,
                data as PrivateMessageDeleteNoticeEvent.Data<Id>,
            );
        case "notice.friend_increase":
            return new FriendIncreaseNoticeEvent(
                helper,
                data as FriendIncreaseNoticeEvent.Data<Id>,
            );
        case "notice.friend_decrease":
            return new FriendDecreaseNoticeEvent(
                helper,
                data as FriendDecreaseNoticeEvent.Data<Id>,
            );
        case "request.friend":
            return new FriendRequestEvent(helper, data as FriendRequestEvent.Data<Id>);
        case "request.group":
            return new GroupRequestEvent(helper, data as GroupRequestEvent.Data<Id>);
        case "meta.lifecycle":
            return new LifecycleMetaEvent(helper, data as LifecycleMetaEvent.Data<Id>);
        case "meta.heartbeat":
            return new HeartbeatMetaEvent(helper, data as HeartbeatMetaEvent.Data<Id>);
        case "meta.status_update":
            return new StatusUpdateMetaEvent(helper, data as StatusUpdateMetaEvent.Data<Id>);
    }
}

/** 将 Adapter 发出的结构化数据构造成带行为的标准事件对象。 */
export class EventFactory {
    static create<Id extends string | number, Type extends keyof EventMap<Id>>(
        type: Type,
        data: EventDataMap<Id>[Type],
        helper: ImHelper<Id>,
    ): EventTypeMap<Id>[Type] {
        return createKnownEvent(type, data, helper) as EventTypeMap<Id>[Type];
    }

    /** Adapter 是运行时输入 seam；未知数据只在工厂内部进入类型化构造流程。 */
    static createFromUnknown<Id extends string | number, Type extends keyof EventMap<Id>>(
        type: Type,
        data: unknown,
        helper: ImHelper<Id>,
    ): EventTypeMap<Id>[Type] {
        assertEventData(type, data);
        return createKnownEvent(
            type,
            data as EventDataMap<Id>[keyof EventDataMap<Id>],
            helper,
        ) as EventTypeMap<Id>[Type];
    }

    static createBatch<Id extends string | number>(
        events: EventInput<Id>[],
        helper: ImHelper<Id>,
    ): BaseEvent<Id>[] {
        return events.map(event => createKnownEvent(event.type, event.data, helper));
    }

    static getSupportedEventTypes<Id extends string | number>(): Array<keyof EventMap<Id>> {
        return [...supportedEventTypes];
    }
}
