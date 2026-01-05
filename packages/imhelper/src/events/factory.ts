import type { ImHelper } from '../imhelper.js';
import type { EventMap } from '../types.js';
import { PrivateMessageEvent } from './message/private.js';
import { GroupMessageEvent } from './message/group.js';
import { ChannelMessageEvent } from './message/channel.js';
import { GroupMemberIncreaseNoticeEvent } from './notice/group-member-increase.js';
import { GroupMemberDecreaseNoticeEvent } from './notice/group-member-decrease.js';
import { GroupMessageDeleteNoticeEvent } from './notice/group-message-delete.js';
import { PrivateMessageDeleteNoticeEvent } from './notice/private-message-delete.js';
import { FriendIncreaseNoticeEvent } from './notice/friend-increase.js';
import { FriendDecreaseNoticeEvent } from './notice/friend-decrease.js';
import { FriendRequestEvent } from './request/friend.js';
import { GroupRequestEvent } from './request/group.js';
import { LifecycleMetaEvent } from './meta/lifecycle.js';
import { HeartbeatMetaEvent } from './meta/heartbeat.js';
import { StatusUpdateMetaEvent } from './meta/status-update.js';
import type { BaseEvent } from './base.js';

/**
 * 事件类型映射
 * 将事件类型字符串映射到对应的构造函数
 */
type EventTypeMap<Id extends string | number> = {
    'message.private': PrivateMessageEvent<Id>;
    'message.group': GroupMessageEvent<Id>;
    'message.channel': ChannelMessageEvent<Id>;
    'notice.group_member_increase': GroupMemberIncreaseNoticeEvent<Id>;
    'notice.group_member_decrease': GroupMemberDecreaseNoticeEvent<Id>;
    'notice.group_message_delete': GroupMessageDeleteNoticeEvent<Id>;
    'notice.private_message_delete': PrivateMessageDeleteNoticeEvent<Id>;
    'notice.friend_increase': FriendIncreaseNoticeEvent<Id>;
    'notice.friend_decrease': FriendDecreaseNoticeEvent<Id>;
    'request.friend': FriendRequestEvent<Id>;
    'request.group': GroupRequestEvent<Id>;
    'meta.lifecycle': LifecycleMetaEvent<Id>;
    'meta.heartbeat': HeartbeatMetaEvent<Id>;
    'meta.status_update': StatusUpdateMetaEvent<Id>;
};

/**
 * 事件工厂类
 * 统一管理事件对象的创建，减少重复代码
 */
export class EventFactory {
    /**
     * 创建事件对象（类型安全版本）
     * @param type 事件类型
     * @param data 事件数据（对应类型的 Data 接口）
     * @param helper ImHelper 实例
     * @returns 创建的事件对象
     */
    static create<Id extends string | number, T extends keyof EventMap<Id>>(
        type: T,
        data: any, // EventMap 定义的是事件对象类型，不是 Data 类型，所以使用 any
        helper: ImHelper<Id>
    ): EventTypeMap<Id>[T] {
        // 验证必要字段
        if (!data || typeof data !== 'object') {
            throw new Error(`Invalid event data for type: ${type}`);
        }

        if (typeof (data as any).timestamp !== 'number') {
            throw new Error(`Event data must have a valid timestamp: ${type}`);
        }

        switch (type) {
            // 消息事件
            case 'message.private':
                return new PrivateMessageEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'message.group':
                return new GroupMessageEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'message.channel':
                return new ChannelMessageEvent(helper, data as any) as EventTypeMap<Id>[T];

            // 通知事件
            case 'notice.group_member_increase':
                return new GroupMemberIncreaseNoticeEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'notice.group_member_decrease':
                return new GroupMemberDecreaseNoticeEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'notice.group_message_delete':
                return new GroupMessageDeleteNoticeEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'notice.private_message_delete':
                return new PrivateMessageDeleteNoticeEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'notice.friend_increase':
                return new FriendIncreaseNoticeEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'notice.friend_decrease':
                return new FriendDecreaseNoticeEvent(helper, data as any) as EventTypeMap<Id>[T];

            // 请求事件
            case 'request.friend':
                return new FriendRequestEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'request.group':
                return new GroupRequestEvent(helper, data as any) as EventTypeMap<Id>[T];

            // 元事件
            case 'meta.lifecycle':
                return new LifecycleMetaEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'meta.heartbeat':
                return new HeartbeatMetaEvent(helper, data as any) as EventTypeMap<Id>[T];
            case 'meta.status_update':
                return new StatusUpdateMetaEvent(helper, data as any) as EventTypeMap<Id>[T];

            default:
                throw new Error(`Unknown event type: ${String(type)}`);
        }
    }

    /**
     * 批量创建事件对象
     */
    static createBatch<Id extends string | number>(
        events: Array<{ type: keyof EventMap<Id>; data: any }>,
        helper: ImHelper<Id>
    ): BaseEvent<Id>[] {
        return events.map(event => this.create(event.type, event.data, helper));
    }

    /**
     * 获取所有支持的事件类型
     */
    static getSupportedEventTypes<Id extends string | number>(): Array<keyof EventMap<Id>> {
        return [
            'message.private',
            'message.group',
            'message.channel',
            'notice.group_member_increase',
            'notice.group_member_decrease',
            'notice.group_message_delete',
            'notice.private_message_delete',
            'notice.friend_increase',
            'notice.friend_decrease',
            'request.friend',
            'request.group',
            'meta.lifecycle',
            'meta.heartbeat',
            'meta.status_update',
        ];
    }
}

