import { EventEmitter } from "node:events";
import type { Message } from "./message.js";
import { UnsupportedAdapterOperationError } from "./adapter-error.js";
import type { Friend } from "./instances/friend.js";
import type { User } from "./instances/user.js";
import type { Group } from "./instances/group.js";
import type { GroupMember } from "./instances/groupMember.js";
import type { Channel } from "./instances/channel.js";
import type { ChannelMember } from "./instances/channelMember.js";
import type {
    GroupMemberIncreaseNoticeEvent,
    GroupMemberDecreaseNoticeEvent,
    GroupMessageDeleteNoticeEvent,
    ChannelMessageDeleteNoticeEvent,
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
    AnyMessageEventData,
} from "./events/index.js";

const adapterType: unique symbol = Symbol("imhelper.adapter.type");

/** 协议无关的目录读取策略，由具体适配器映射到平台刷新参数。 */
export interface DirectoryQueryOptions<Id extends string | number = string | number> {
    fresh?: boolean;
    /** 目录必须依附其他实体时显式携带作用域，禁止从 ID 形状猜测父级。 */
    scope?: {
        type: "group" | "channel";
        id: Id;
    };
}

export abstract class Adapter<
    Id extends string | number = string | number,
    TRawEvent = unknown,
> extends EventEmitter<Adapter.EventMap<Id, TRawEvent>> {
    declare readonly [adapterType]: { id: Id; rawEvent: TRawEvent };
    /** 机器人自身ID */
    abstract readonly selfId: string;

    protected unsupported(operation: string): never {
        throw new UnsupportedAdapterOperationError(operation);
    }
    /** 发送消息 */
    async sendMessage(_options: Adapter.SendMessageOptions<Id>): Promise<Message.Ret> {
        return this.unsupported("sendMessage");
    }
    /** 带来源消息与协议上下文的回复入口；默认退化为普通发送。 */
    async replyMessage(options: Adapter.ReplyMessageOptions<Id>): Promise<Message.Ret> {
        return this.sendMessage({
            scene_type: options.scene_type,
            scene_id: options.scene_id,
            message: options.message,
        });
    }
    /** 撤回消息 */
    async recallMessage(_message_id: Id): Promise<boolean> {
        return this.unsupported("recallMessage");
    }
    /** 带场景上下文的撤回入口，供要求 channel_id 的协议覆盖。 */
    async recallMessageIn(options: Adapter.MessageContextOptions<Id>): Promise<boolean> {
        return this.recallMessage(options.message_id);
    }
    async getUserList(_options?: DirectoryQueryOptions<Id>): Promise<User.Data<Id>[]> {
        return this.unsupported("getUserList");
    }
    async getUserInfo(_user_id: Id, _options?: DirectoryQueryOptions<Id>): Promise<User.Data<Id>> {
        return this.unsupported("getUserInfo");
    }
    async getFriendInfo(
        _user_id: Id,
        _options?: DirectoryQueryOptions<Id>,
    ): Promise<Friend.Data<Id>> {
        return this.unsupported("getFriendInfo");
    }
    async getGroupList(_options?: DirectoryQueryOptions<Id>): Promise<Group.Data<Id>[]> {
        return this.unsupported("getGroupList");
    }
    async getGroupInfo(
        _group_id: Id,
        _options?: DirectoryQueryOptions<Id>,
    ): Promise<Group.Data<Id>> {
        return this.unsupported("getGroupInfo");
    }
    async getGroupMemberList(
        _group_id: Id,
        _options?: DirectoryQueryOptions<Id>,
    ): Promise<GroupMember.Data<Id>[]> {
        return this.unsupported("getGroupMemberList");
    }
    async getGroupMemberInfo(
        _group_id: Id,
        _user_id: Id,
        _options?: DirectoryQueryOptions<Id>,
    ): Promise<GroupMember.Data<Id>> {
        return this.unsupported("getGroupMemberInfo");
    }
    async getChannelList(_options?: DirectoryQueryOptions<Id>): Promise<Channel.Data<Id>[]> {
        return this.unsupported("getChannelList");
    }
    async getChannelInfo(
        _channel_id: Id,
        _options?: DirectoryQueryOptions<Id>,
    ): Promise<Channel.Data<Id>> {
        return this.unsupported("getChannelInfo");
    }
    async getChannelMemberList(_channel_id: Id): Promise<ChannelMember.Data<Id>[]> {
        return this.unsupported("getChannelMemberList");
    }
    async getChannelMemberInfo(_channel_id: Id, _user_id: Id): Promise<ChannelMember.Data<Id>> {
        return this.unsupported("getChannelMemberInfo");
    }
    async kickGroupMember(_group_id: Id, _user_id: Id): Promise<void> {
        return this.unsupported("kickGroupMember");
    }
    async setGroupMemberMute(_group_id: Id, _user_id: Id, _duration: number): Promise<void> {
        return this.unsupported("setGroupMemberMute");
    }
    async setChannelMemberAdmin(
        _channel_id: Id,
        _user_id: Id,
        _admin: boolean = true,
    ): Promise<void> {
        return this.unsupported("setChannelMemberAdmin");
    }
    async setChannelMemberOwner(
        _channel_id: Id,
        _user_id: Id,
        _owner: boolean = true,
    ): Promise<void> {
        return this.unsupported("setChannelMemberOwner");
    }
    async setGroupMemberAdmin(_group_id: Id, _user_id: Id, _admin: boolean = true): Promise<void> {
        return this.unsupported("setGroupMemberAdmin");
    }
    async setGroupMemberOwner(_group_id: Id, _user_id: Id, _owner: boolean = true): Promise<void> {
        return this.unsupported("setGroupMemberOwner");
    }
    async addMessageReaction(_message_id: Id, _reaction: string): Promise<void> {
        return this.unsupported("addMessageReaction");
    }
    async addMessageReactionIn(options: Adapter.MessageReactionOptions<Id>): Promise<void> {
        return this.addMessageReaction(options.message_id, options.reaction);
    }
    async deleteMessageReaction(_message_id: Id, _reaction: string): Promise<void> {
        return this.unsupported("deleteMessageReaction");
    }
    async deleteMessageReactionIn(options: Adapter.MessageReactionOptions<Id>): Promise<void> {
        return this.deleteMessageReaction(options.message_id, options.reaction);
    }
    /** 获取消息 */
    async getMessage(_message_id: Id): Promise<AnyMessageEventData<Id>> {
        return this.unsupported("getMessage");
    }
    /** 编辑消息 */
    async updateMessage(_message_id: Id, _content: Message.Content): Promise<void> {
        return this.unsupported("updateMessage");
    }
    async updateMessageIn(options: Adapter.UpdateMessageOptions<Id>): Promise<void> {
        return this.updateMessage(options.message_id, options.content);
    }
    /** 设置群组名称 */
    async setGroupName(_group_id: Id, _name: string): Promise<void> {
        return this.unsupported("setGroupName");
    }
    /** 退出群组 */
    async leaveGroup(_group_id: Id): Promise<void> {
        return this.unsupported("leaveGroup");
    }
    /** 设置频道名称 */
    async setChannelName(_channel_id: Id, _name: string): Promise<void> {
        return this.unsupported("setChannelName");
    }
    /** 退出频道 */
    async leaveChannel(_channel_id: Id): Promise<void> {
        return this.unsupported("leaveChannel");
    }
    /** 设置群成员名片 */
    async setGroupMemberCard(_group_id: Id, _user_id: Id, _card: string): Promise<void> {
        return this.unsupported("setGroupMemberCard");
    }
    /** 取消群成员管理员 */
    async unsetGroupMemberAdmin(_group_id: Id, _user_id: Id): Promise<void> {
        return this.unsupported("unsetGroupMemberAdmin");
    }
    /** 取消群成员群主 */
    async unsetGroupMemberOwner(_group_id: Id, _user_id: Id): Promise<void> {
        return this.unsupported("unsetGroupMemberOwner");
    }
    /** 取消频道成员管理员 */
    async unsetChannelMemberAdmin(_channel_id: Id, _user_id: Id): Promise<void> {
        return this.unsupported("unsetChannelMemberAdmin");
    }
    /** 取消频道成员所有者 */
    async unsetChannelMemberOwner(_channel_id: Id, _user_id: Id): Promise<void> {
        return this.unsupported("unsetChannelMemberOwner");
    }
    /** 删除好友 */
    async deleteFriend(_user_id: Id): Promise<void> {
        return this.unsupported("deleteFriend");
    }
    /** 处理加好友请求 */
    async approveFriendRequest(
        _request_id: Id,
        _approve: boolean,
        _comment?: string,
    ): Promise<void> {
        return this.unsupported("approveFriendRequest");
    }
    /** 处理加群请求 */
    async approveGroupRequest(_request_id: Id, _approve: boolean, _reason?: string): Promise<void> {
        return this.unsupported("approveGroupRequest");
    }
    /** 上传文件 */
    async uploadFile(
        _file: File | Blob | Buffer,
        _filename?: string,
    ): Promise<{ file_id: Id; url?: string }> {
        return this.unsupported("uploadFile");
    }
    /** 获取文件 */
    async getFile(_file_id: Id): Promise<{ url: string; size?: number }> {
        return this.unsupported("getFile");
    }
    /** 转换事件（可选，用于接收器） */
    transformEvent(event: TRawEvent): void {
        this.emit("event", event);
    }

    /** 启动适配器（可选） */
    start?(port?: number): Promise<void>;

    /** 停止适配器（可选） */
    stop?(): Promise<void>;
}
export namespace Adapter {
    export interface Type {
        readonly [adapterType]: { id: string | number; rawEvent: unknown };
    }
    export type IdOf<TAdapter extends Type> = TAdapter[typeof adapterType]["id"];
    export type RawEventOf<TAdapter extends Type> = TAdapter[typeof adapterType]["rawEvent"];
    export interface EventMap<Id extends string | number, TRawEvent = unknown> {
        "event": [TRawEvent];
        "message.private": [PrivateMessageEvent.Data<Id>];
        "message.group": [GroupMessageEvent.Data<Id>];
        "message.channel": [ChannelMessageEvent.Data<Id>];
        "notice.group_member_increase": [GroupMemberIncreaseNoticeEvent.Data<Id>];
        "notice.group_member_decrease": [GroupMemberDecreaseNoticeEvent.Data<Id>];
        "notice.group_message_delete": [GroupMessageDeleteNoticeEvent.Data<Id>];
        "notice.channel_message_delete": [ChannelMessageDeleteNoticeEvent.Data<Id>];
        "notice.private_message_delete": [PrivateMessageDeleteNoticeEvent.Data<Id>];
        "notice.friend_increase": [FriendIncreaseNoticeEvent.Data<Id>];
        "notice.friend_decrease": [FriendDecreaseNoticeEvent.Data<Id>];
        "request.friend": [FriendRequestEvent.Data<Id>];
        "request.group": [GroupRequestEvent.Data<Id>];
        "meta.lifecycle": [LifecycleMetaEvent.Data<Id>];
        "meta.heartbeat": [HeartbeatMetaEvent.Data<Id>];
        "meta.status_update": [StatusUpdateMetaEvent.Data<Id>];
    }

    export interface RecallMessageOptions<Id extends string | number = string | number> {
        id: Id;
    }
    export interface SendMessageOptions<Id extends string | number = string | number> {
        scene_type: Message.SceneType;
        scene_id: Id;
        message: Message.Content;
    }
    export interface MessageContextOptions<Id extends string | number = string | number> {
        message_id: Id;
        scene_type: Message.SceneType;
        scene_id: Id;
        /** 协议需要独立会话地址时保留真实频道 ID。 */
        channel_id?: Id;
    }
    export interface ReplyMessageOptions<
        Id extends string | number = string | number,
    > extends MessageContextOptions<Id> {
        message: Message.Content;
    }
    export interface UpdateMessageOptions<
        Id extends string | number = string | number,
    > extends MessageContextOptions<Id> {
        content: Message.Content;
    }
    export interface MessageReactionOptions<
        Id extends string | number = string | number,
    > extends MessageContextOptions<Id> {
        reaction: string;
    }
}
