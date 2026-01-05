import { EventEmitter } from 'events';
import type { Message } from './message.js';
import { Friend } from './instances/friend.js';
import { User } from './instances/user.js';
import { Group } from './instances/group.js';
import { Channel } from './instances/channel.js';
import type {
    GroupMemberIncreaseNoticeEvent,
    GroupMemberDecreaseNoticeEvent,
    GroupMessageDeleteNoticeEvent,
    PrivateMessageDeleteNoticeEvent,
    FriendIncreaseNoticeEvent,
    FriendDecreaseNoticeEvent,
    FriendRequestEvent,
    GroupRequestEvent,
    LifecycleMetaEvent,
    HeartbeatMetaEvent,
    StatusUpdateMetaEvent,
    PrivateMessageEvent,
    GroupMessageEvent,
    ChannelMessageEvent,
    MessageEvent,
} from './events/index.js';

export abstract class Adapter<Id extends string | number = string | number> extends EventEmitter<Adapter.EventMap<Id>> {
    /** 机器人自身ID */
    abstract readonly selfId: string;
    /** 发送消息 */
    sendMessage(options: Adapter.SendMessageOptions<Id>): Promise<Message.Ret>{
        throw new Error('Not implemented');
    }
    /** 撤回消息 */
    recallMessage(message_id: Id): Promise<boolean>{
        throw new Error('Not implemented');
    }
    async getUserList(): Promise<User<Id>[]>{
        return [];
    }
    getUserInfo(user_id: Id): Promise<User<Id>>{
        throw new Error('Not implemented');
    }
    getFriendInfo(user_id: Id): Promise<Friend<Id>>{
        throw new Error('Not implemented');
    }
    async getGroupList(): Promise<Group<Id>[]>{
        return [];
    }
    getGroupInfo(group_id: Id): Promise<Group<Id>>{
        throw new Error('Not implemented');
    }
    async getGroupMemberList(group_id: Id): Promise<User<Id>[]>{
        return []
    }
    getGroupMemberInfo(group_id: Id, user_id: Id): Promise<User<Id>>{
        throw new Error('Not implemented');
    }
    async getChannelList(): Promise<Channel<Id>[]>{
        return []
    }
    getChannelInfo(channel_id: Id): Promise<Channel<Id>>{
        throw new Error('Not implemented');
    }
    async getChannelMemberList(channel_id: Id): Promise<User<Id>[]>{
        return []
    }
    getChannelMemberInfo(channel_id: Id, user_id: Id): Promise<User<Id>>{
        throw new Error('Not implemented');
    }
    kickGroupMember(group_id: Id, user_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    setGroupMemberMute(group_id: Id, user_id: Id, duration: number): Promise<void>{
        throw new Error('Not implemented');
    }
    setChannelMemberAdmin(channel_id: Id, user_id: Id, admin: boolean = true): Promise<void>{
        throw new Error('Not implemented');
    }
    setChannelMemberOwner(channel_id: Id, user_id: Id, owner: boolean = true): Promise<void>{
        throw new Error('Not implemented');
    }
    setGroupMemberAdmin(group_id: Id, user_id: Id, admin: boolean = true): Promise<void>{
        throw new Error('Not implemented');
    }
    setGroupMemberOwner(group_id: Id, user_id: Id, owner: boolean = true): Promise<void>{
        throw new Error('Not implemented');
    }
    addMessageReaction(message_id: Id, reaction: string): Promise<void>{
        throw new Error('Not implemented');
    }
    deleteMessageReaction(message_id: Id, reaction: string): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 获取消息 */
    getMessage(message_id: Id): Promise<MessageEvent<Id>>{
        throw new Error('Not implemented');
    }
    /** 编辑消息 */
    updateMessage(message_id: Id, content: Message.Content): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 设置群组名称 */
    setGroupName(group_id: Id, name: string): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 退出群组 */
    leaveGroup(group_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 设置频道名称 */
    setChannelName(channel_id: Id, name: string): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 退出频道 */
    leaveChannel(channel_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 设置群成员名片 */
    setGroupMemberCard(group_id: Id, user_id: Id, card: string): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 取消群成员管理员 */
    unsetGroupMemberAdmin(group_id: Id, user_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 取消群成员群主 */
    unsetGroupMemberOwner(group_id: Id, user_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 取消频道成员管理员 */
    unsetChannelMemberAdmin(channel_id: Id, user_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 取消频道成员所有者 */
    unsetChannelMemberOwner(channel_id: Id, user_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 删除好友 */
    deleteFriend(user_id: Id): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 处理加好友请求 */
    approveFriendRequest(request_id: Id, approve: boolean, comment?: string): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 处理加群请求 */
    approveGroupRequest(request_id: Id, approve: boolean, reason?: string): Promise<void>{
        throw new Error('Not implemented');
    }
    /** 上传文件 */
    uploadFile(file: File | Blob | Buffer, filename?: string): Promise<{ file_id: Id; url?: string }>{
        throw new Error('Not implemented');
    }
    /** 获取文件 */
    getFile(file_id: Id): Promise<{ url: string; size?: number }>{
        throw new Error('Not implemented');
    }
    /** 转换事件（可选，用于接收器） */
    transformEvent?(event: unknown): void {
        // 默认实现：直接触发原始事件
        // 使用 EventEmitter 的原始 emit 方法，因为 'event' 不在 EventMap 中
        (this as EventEmitter).emit('event', event);
    }

    /** 启动适配器（可选） */
    start?(port?: number): Promise<void>;

    /** 停止适配器（可选） */
    stop?(): Promise<void>;
}
export namespace Adapter {
    export interface EventMap<Id extends string | number>{
        'message.private': [PrivateMessageEvent.Data<Id>]
        'message.group': [GroupMessageEvent.Data<Id>]
        'message.channel': [ChannelMessageEvent.Data<Id>]
        'notice.group_member_increase': [GroupMemberIncreaseNoticeEvent.Data<Id>]
        'notice.group_member_decrease': [GroupMemberDecreaseNoticeEvent.Data<Id>]
        'notice.group_message_delete': [GroupMessageDeleteNoticeEvent.Data<Id>]
        'notice.private_message_delete': [PrivateMessageDeleteNoticeEvent.Data<Id>]
        'notice.friend_increase': [FriendIncreaseNoticeEvent.Data<Id>]
        'notice.friend_decrease': [FriendDecreaseNoticeEvent.Data<Id>]
        'request.friend': [FriendRequestEvent.Data<Id>]
        'request.group': [GroupRequestEvent.Data<Id>]
        'meta.lifecycle': [LifecycleMetaEvent.Data<Id>]
        'meta.heartbeat': [HeartbeatMetaEvent.Data<Id>]
        'meta.status_update': [StatusUpdateMetaEvent.Data<Id>]
    }
    
    // 为了向后兼容，保留这些类型别名
    export type NoticeEvent<Id extends string | number = string | number> = import('./events/notice/base.js').NoticeEvent<Id>;
    export type RequestEvent<Id extends string | number = string | number> = import('./events/request/base.js').RequestEvent<Id>;
    export type MetaEvent<Id extends string | number = string | number> = import('./events/meta/base.js').MetaEvent<Id>;
    export interface RecallMessageOptions<Id extends string | number=string|number> {
        id: Id;
    }
    export interface SendMessageOptions<Id extends string | number=string|number> {
        scene_type: Message.SceneType;
        scene_id: Id;
        message: Message.Content;
    }
}