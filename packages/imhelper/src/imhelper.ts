import { EventEmitter } from "node:events";
import { Adapter, type DirectoryQueryOptions } from "./adapter.js";
import { Group } from "./instances/group.js";
import { Channel } from "./instances/channel.js";
import { User } from "./instances/user.js";
import { Friend } from "./instances/friend.js";
import { GroupMember } from "./instances/groupMember.js";
import { ChannelMember } from "./instances/channelMember.js";
import { Message } from "./message.js";
import type { EventMap } from "./types.js";
import { EventFactory } from "./events/factory.js";
import type { AnyMessageEvent, AnyMessageEventData } from "./events/index.js";
import {
    acceptHttpIngress,
    acceptWebSocketIngress,
    type HttpIngressRequest,
    type HttpIngressResponseWriter,
    type HttpIngressResult,
    type UpgradedWebSocket,
} from "./ingress.js";
type GroupMemberMap<Id extends string | number> = Map<Id, GroupMember.Data<Id>>;
type ChannelMemberMap<Id extends string | number> = Map<Id, ChannelMember.Data<Id>>;

function synchronizeMap<Key, Value extends object>(
    target: Map<Key, Value>,
    values: readonly Value[],
    keyOf: (value: Value) => Key,
): void {
    const retained = new Set<Key>();
    for (const value of values) {
        const key = keyOf(value);
        retained.add(key);
        const current = target.get(key);
        if (current) Object.assign(current, value);
        else target.set(key, value);
    }
    for (const key of target.keys()) {
        if (!retained.has(key)) target.delete(key);
    }
}

function upsertMap<Key, Value extends object>(
    target: Map<Key, Value>,
    key: Key,
    value: Value,
): void {
    const current = target.get(key);
    if (current) Object.assign(current, value);
    else target.set(key, value);
}
export type ImHelperEventMap<
    Id extends string | number,
    TRawEvent,
    TEventMap extends EventMap<Id> = EventMap<Id>,
> = Omit<TEventMap, "event"> & { event: [TRawEvent] };

type ImHelperEventName<
    Id extends string | number,
    TRawEvent,
    TEventMap extends EventMap<Id>,
> = keyof ImHelperEventMap<Id, TRawEvent, TEventMap>;

type ImHelperEventArgs<
    Id extends string | number,
    TRawEvent,
    TEventMap extends EventMap<Id>,
    K extends ImHelperEventName<Id, TRawEvent, TEventMap>,
> = Extract<ImHelperEventMap<Id, TRawEvent, TEventMap>[K], unknown[]>;

type UntypedListener = Parameters<EventEmitter["on"]>[1];
type AdapterSendResult<TAdapter, Id extends string | number> = TAdapter extends {
    sendMessage(options: Adapter.SendMessageOptions<Id>): infer TResult;
}
    ? TResult
    : Promise<Message.Ret>;

export interface ImHelperLogger {
    error(message: string, error: unknown): void;
}

export interface ImHelperOptions {
    logger?: ImHelperLogger;
}

const silentLogger: ImHelperLogger = {
    error: () => undefined,
};

export class ImHelper<
    Id extends string | number = string | number,
    TRawEvent = unknown,
    TEventMap extends EventMap<Id> = EventMap<Id>,
    TAdapter extends Adapter<Id, TRawEvent> = Adapter<Id, TRawEvent>,
> extends EventEmitter {
    #adapter: TAdapter;
    readonly #logger: ImHelperLogger;
    $userMap: Map<Id, User.Data<Id>> = new Map<Id, User.Data<Id>>();
    $friendMap: Map<Id, Friend.Data<Id>> = new Map<Id, Friend.Data<Id>>();
    $groupMap: Map<Id, Group.Data<Id>> = new Map<Id, Group.Data<Id>>();
    $groupMemberMap: Map<Id, GroupMemberMap<Id>> = new Map<Id, GroupMemberMap<Id>>();
    $channelMap: Map<Id, Channel.Data<Id>> = new Map<Id, Channel.Data<Id>>();
    $channelMemberMap: Map<Id, ChannelMemberMap<Id>> = new Map<Id, ChannelMemberMap<Id>>();
    pickUser = User.from.bind(this) as typeof User.from;
    pickFriend = Friend.from.bind(this) as typeof Friend.from;
    pickGroup = Group.from.bind(this) as typeof Group.from;
    pickChannel = Channel.from.bind(this) as typeof Channel.from;
    pickGroupMember = GroupMember.from.bind(this) as typeof GroupMember.from;
    pickChannelMember = ChannelMember.from.bind(this) as typeof ChannelMember.from;
    constructor(adapter: TAdapter, options: ImHelperOptions = {}) {
        super();
        this.#adapter = adapter;
        this.#logger = options.logger ?? silentLogger;

        // 从 EventFactory 自动获取所有支持的事件类型
        const eventTypes = EventFactory.getSupportedEventTypes<Id>();

        // 统一处理事件转发
        for (const eventType of eventTypes) {
            (adapter as EventEmitter).on(eventType, (data: unknown) => {
                try {
                    const event = EventFactory.createFromUnknown(eventType, data, this);
                    (this as EventEmitter).emit(eventType, event);
                } catch (error) {
                    this.#logger.error(`创建事件 ${String(eventType)} 失败`, error);
                }
            });
        }

        // 转发 adapter 的原始事件
        adapter.on("event", (event: TRawEvent) => {
            this.emit("event", event);
        });
    }

    on<K extends ImHelperEventName<Id, TRawEvent, TEventMap>>(
        eventName: K,
        listener: (...args: ImHelperEventArgs<Id, TRawEvent, TEventMap, K>) => void,
    ): this;
    override on(eventName: string | symbol, listener: UntypedListener): this;
    override on(eventName: string | symbol, listener: UntypedListener): this {
        return super.on(eventName, listener);
    }

    once<K extends ImHelperEventName<Id, TRawEvent, TEventMap>>(
        eventName: K,
        listener: (...args: ImHelperEventArgs<Id, TRawEvent, TEventMap, K>) => void,
    ): this;
    override once(eventName: string | symbol, listener: UntypedListener): this;
    override once(eventName: string | symbol, listener: UntypedListener): this {
        return super.once(eventName, listener);
    }

    off<K extends ImHelperEventName<Id, TRawEvent, TEventMap>>(
        eventName: K,
        listener: (...args: ImHelperEventArgs<Id, TRawEvent, TEventMap, K>) => void,
    ): this;
    override off(eventName: string | symbol, listener: UntypedListener): this;
    override off(eventName: string | symbol, listener: UntypedListener): this {
        return super.off(eventName, listener);
    }

    emit<K extends ImHelperEventName<Id, TRawEvent, TEventMap>>(
        eventName: K,
        ...args: ImHelperEventArgs<Id, TRawEvent, TEventMap, K>
    ): boolean;
    override emit(eventName: string | symbol, ...args: unknown[]): boolean;
    override emit(eventName: string | symbol, ...args: unknown[]): boolean {
        return super.emit(eventName, ...args);
    }
    get adapter() {
        return this.#adapter;
    }
    sendPrivateMessage(userId: Id, message: Message.Content): AdapterSendResult<TAdapter, Id> {
        return this.#adapter.sendMessage({
            scene_type: "private",
            scene_id: userId,
            message: message,
        }) as AdapterSendResult<TAdapter, Id>;
    }
    sendGroupMessage(groupId: Id, message: Message.Content): AdapterSendResult<TAdapter, Id> {
        return this.#adapter.sendMessage({
            scene_type: "group",
            scene_id: groupId,
            message: message,
        }) as AdapterSendResult<TAdapter, Id>;
    }
    sendChannelMessage(
        channelId: Id,
        message: Message.Content,
        guildId?: Id,
    ): AdapterSendResult<TAdapter, Id> {
        return this.#adapter.sendMessage({
            scene_type: "channel",
            scene_id: channelId,
            guild_id: guildId,
            message: message,
        }) as AdapterSendResult<TAdapter, Id>;
    }
    async start(port?: number): Promise<void> {
        return this.#adapter.start?.(port);
    }

    async stop(): Promise<void> {
        return this.#adapter.stop?.();
    }

    /** 将宿主已经接收到的协议原始事件交给当前客户端。 */
    ingest(rawEvent: TRawEvent): void {
        this.#adapter.transformEvent(rawEvent);
    }

    /** 接收已有 HTTP 服务上的事件请求；response 可省略以获取结构化响应。 */
    acceptHttp(
        request: HttpIngressRequest,
        response?: HttpIngressResponseWriter,
    ): Promise<HttpIngressResult> {
        return acceptHttpIngress<TRawEvent>(request, response, rawEvent => this.ingest(rawEvent));
    }

    /** 接收宿主已经完成 HTTP Upgrade 的 WebSocket。返回函数用于解除监听。 */
    acceptWebSocket(socket: UpgradedWebSocket): () => void {
        return acceptWebSocketIngress<TRawEvent>(socket, rawEvent => this.ingest(rawEvent));
    }

    // ============================================
    // 批量操作方法
    // ============================================

    /** 批量获取用户信息 */
    async getUserList(options?: DirectoryQueryOptions<Id>): Promise<User<Id>[]> {
        const users = await this.#adapter.getUserList(options);
        synchronizeMap(this.$userMap, users, user => user.user_id);
        return users.map(user => this.pickUser(user.user_id));
    }

    async getUserInfo(userId: Id, options?: DirectoryQueryOptions<Id>): Promise<User<Id>> {
        const user = await this.#adapter.getUserInfo(userId, options);
        upsertMap(this.$userMap, user.user_id, user);
        return this.pickUser(user.user_id);
    }

    async getFriendInfo(userId: Id, options?: DirectoryQueryOptions<Id>): Promise<Friend<Id>> {
        const friend = await this.#adapter.getFriendInfo(userId, options);
        upsertMap(this.$userMap, friend.user_id, friend);
        upsertMap(this.$friendMap, friend.user_id, friend);
        return this.pickFriend(friend.user_id);
    }

    /** 批量获取群组列表 */
    async getGroupList(options?: DirectoryQueryOptions<Id>): Promise<Group<Id>[]> {
        const groups = await this.#adapter.getGroupList(options);
        synchronizeMap(this.$groupMap, groups, group => group.group_id);
        return groups.map(group => this.pickGroup(group.group_id));
    }

    async getGroupInfo(groupId: Id, options?: DirectoryQueryOptions<Id>): Promise<Group<Id>> {
        const group = await this.#adapter.getGroupInfo(groupId, options);
        upsertMap(this.$groupMap, group.group_id, group);
        return this.pickGroup(group.group_id);
    }

    async getGroupMemberInfo(
        groupId: Id,
        userId: Id,
        options?: DirectoryQueryOptions<Id>,
    ): Promise<GroupMember<Id>> {
        const member = await this.#adapter.getGroupMemberInfo(groupId, userId, options);
        const members = this.$groupMemberMap.get(groupId) ?? new Map<Id, GroupMember.Data<Id>>();
        this.$groupMemberMap.set(groupId, members);
        upsertMap(members, member.user_id, member);
        upsertMap(this.$userMap, member.user_id, member);
        return this.pickGroupMember(groupId, member.user_id);
    }

    async getGroupMemberList(
        groupId: Id,
        options?: DirectoryQueryOptions<Id>,
    ): Promise<GroupMember<Id>[]> {
        const memberData = await this.#adapter.getGroupMemberList(groupId, options);
        const members = this.$groupMemberMap.get(groupId) ?? new Map<Id, GroupMember.Data<Id>>();
        synchronizeMap(members, memberData, member => member.user_id);
        this.$groupMemberMap.set(groupId, members);
        for (const member of memberData) {
            upsertMap(this.$userMap, member.user_id, member);
        }
        return memberData.map(member => this.pickGroupMember(groupId, member.user_id));
    }

    /** 批量获取频道列表 */
    async getChannelList(options?: DirectoryQueryOptions<Id>): Promise<Channel<Id>[]> {
        const channels = await this.#adapter.getChannelList(options);
        synchronizeMap(this.$channelMap, channels, channel => channel.channel_id);
        return channels.map(channel => this.pickChannel(channel.channel_id));
    }

    async getChannelInfo(channelId: Id, options?: DirectoryQueryOptions<Id>): Promise<Channel<Id>> {
        const channel = await this.#adapter.getChannelInfo(channelId, options);
        upsertMap(this.$channelMap, channel.channel_id, channel);
        return this.pickChannel(channel.channel_id);
    }

    async getChannelMemberInfo(channelId: Id, userId: Id): Promise<ChannelMember<Id>> {
        const member = await this.#adapter.getChannelMemberInfo(channelId, userId);
        const members =
            this.$channelMemberMap.get(channelId) ?? new Map<Id, ChannelMember.Data<Id>>();
        this.$channelMemberMap.set(channelId, members);
        upsertMap(members, member.user_id, member);
        upsertMap(this.$userMap, member.user_id, member);
        return this.pickChannelMember(channelId, member.user_id);
    }

    async getChannelMemberList(channelId: Id): Promise<ChannelMember<Id>[]> {
        const memberData = await this.#adapter.getChannelMemberList(channelId);
        const members =
            this.$channelMemberMap.get(channelId) ?? new Map<Id, ChannelMember.Data<Id>>();
        synchronizeMap(members, memberData, member => member.user_id);
        this.$channelMemberMap.set(channelId, members);
        for (const member of memberData) {
            upsertMap(this.$userMap, member.user_id, member);
        }
        return memberData.map(member => this.pickChannelMember(channelId, member.user_id));
    }

    /** 获取消息并绑定到当前 helper，使 reply/recall 等行为始终可用。 */
    async getMessage(messageId: Id): Promise<AnyMessageEvent<Id>> {
        const data = await this.#adapter.getMessage(messageId);
        return this.#createMessageEvent(data);
    }

    #createMessageEvent(data: AnyMessageEventData<Id>): AnyMessageEvent<Id> {
        switch (data.message_type) {
            case "private":
                return EventFactory.create("message.private", data, this);
            case "group":
                return EventFactory.create("message.group", data, this);
            case "channel":
                return EventFactory.create("message.channel", data, this);
        }
    }

    // ============================================
    // 文件操作方法
    // ============================================

    /** 上传文件 */
    async uploadFile(
        file: File | Blob | Buffer,
        filename?: string,
    ): Promise<{ file_id: Id; url?: string }> {
        return this.#adapter.uploadFile(file, filename);
    }

    /** 获取文件 */
    async getFile(file_id: Id): Promise<{ url: string; size?: number }> {
        return this.#adapter.getFile(file_id);
    }

    // ============================================
    // 请求处理方法
    // ============================================

    /** 处理加好友请求 */
    async approveFriendRequest(
        request_id: Id,
        approve: boolean = true,
        comment?: string,
    ): Promise<void> {
        return this.#adapter.approveFriendRequest(request_id, approve, comment);
    }

    /** 处理加群请求 */
    async approveGroupRequest(
        request_id: Id,
        approve: boolean = true,
        reason?: string,
    ): Promise<void> {
        return this.#adapter.approveGroupRequest(request_id, approve, reason);
    }
}
