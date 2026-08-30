import { EventEmitter } from "node:events";
import type { Message } from "./message.js";
import { UnsupportedAdapterOperationError } from "./adapter-error.js";
import { Friend } from "./instances/friend.js";
import { User } from "./instances/user.js";
import { Group } from "./instances/group.js";
import { Channel } from "./instances/channel.js";
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
} from "./events/index.js";

const adapterType: unique symbol = Symbol("imhelper.adapter.type");

/** 协议无关的目录读取策略，由具体适配器映射到平台刷新参数。 */
export interface DirectoryQueryOptions {
    fresh?: boolean;
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
    /** 撤回消息 */
    async recallMessage(_message_id: Id): Promise<boolean> {
        return this.unsupported("recallMessage");
    }
    async getUserList(_options?: DirectoryQueryOptions): Promise<User<Id>[]> {
        return this.unsupported("getUserList");
    }
    async getUserInfo(_user_id: Id, _options?: DirectoryQueryOptions): Promise<User<Id>> {
        return this.unsupported("getUserInfo");
    }
    async getFriendInfo(_user_id: Id, _options?: DirectoryQueryOptions): Promise<Friend<Id>> {
        return this.unsupported("getFriendInfo");
    }
    async getGroupList(_options?: DirectoryQueryOptions): Promise<Group<Id>[]> {
        return this.unsupported("getGroupList");
    }
    async getGroupInfo(_group_id: Id, _options?: DirectoryQueryOptions): Promise<Group<Id>> {
        return this.unsupported("getGroupInfo");
    }
    async getGroupMemberList(_group_id: Id, _options?: DirectoryQueryOptions): Promise<User<Id>[]> {
        return this.unsupported("getGroupMemberList");
    }
    async getGroupMemberInfo(
        _group_id: Id,
        _user_id: Id,
        _options?: DirectoryQueryOptions,
    ): Promise<User<Id>> {
        return this.unsupported("getGroupMemberInfo");
    }
    async getChannelList(): Promise<Channel<Id>[]> {
        return this.unsupported("getChannelList");
    }
    async getChannelInfo(_channel_id: Id): Promise<Channel<Id>> {
        return this.unsupported("getChannelInfo");
    }
    async getChannelMemberList(_channel_id: Id): Promise<User<Id>[]> {
        return this.unsupported("getChannelMemberList");
    }
    async getChannelMemberInfo(_channel_id: Id, _user_id: Id): Promise<User<Id>> {
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
    async deleteMessageReaction(_message_id: Id, _reaction: string): Promise<void> {
        return this.unsupported("deleteMessageReaction");
    }
    /** 获取消息 */
    async getMessage(_message_id: Id): Promise<MessageEvent<Id>> {
        return this.unsupported("getMessage");
    }
    /** 编辑消息 */
    async updateMessage(_message_id: Id, _content: Message.Content): Promise<void> {
        return this.unsupported("updateMessage");
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
}
