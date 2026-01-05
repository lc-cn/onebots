import { PrivateMessageEvent } from './events/message/private.js';
import { GroupMessageEvent } from './events/message/group.js';
import { ChannelMessageEvent } from './events/message/channel.js';
import { GroupMemberIncreaseNoticeEvent } from './events/notice/group-member-increase.js';
import { GroupMemberDecreaseNoticeEvent } from './events/notice/group-member-decrease.js';
import { GroupMessageDeleteNoticeEvent } from './events/notice/group-message-delete.js';
import { PrivateMessageDeleteNoticeEvent } from './events/notice/private-message-delete.js';
import { FriendIncreaseNoticeEvent } from './events/notice/friend-increase.js';
import { FriendDecreaseNoticeEvent } from './events/notice/friend-decrease.js';
import { FriendRequestEvent } from './events/request/friend.js';
import { GroupRequestEvent } from './events/request/group.js';
import { LifecycleMetaEvent } from './events/meta/lifecycle.js';
import { HeartbeatMetaEvent } from './events/meta/heartbeat.js';
import { StatusUpdateMetaEvent } from './events/meta/status-update.js';
export type MaybeArray<T extends any> = T | T[];
export interface EventMap<Id extends string | number>{
    'message.private': [PrivateMessageEvent<Id>]
    'message.group': [GroupMessageEvent<Id>]
    'message.channel': [ChannelMessageEvent<Id>]
    'notice.group_member_increase': [GroupMemberIncreaseNoticeEvent<Id>]
    'notice.group_member_decrease': [GroupMemberDecreaseNoticeEvent<Id>]
    'notice.group_message_delete': [GroupMessageDeleteNoticeEvent<Id>]
    'notice.private_message_delete': [PrivateMessageDeleteNoticeEvent<Id>]
    'notice.friend_increase': [FriendIncreaseNoticeEvent<Id>]
    'notice.friend_decrease': [FriendDecreaseNoticeEvent<Id>]
    'request.friend': [FriendRequestEvent<Id>]
    'request.group': [GroupRequestEvent<Id>]
    'meta.lifecycle': [LifecycleMetaEvent<Id>]
    'meta.heartbeat': [HeartbeatMetaEvent<Id>]
    'meta.status_update': [StatusUpdateMetaEvent<Id>]
}