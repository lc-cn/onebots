import { EventEmitter } from "events";
import { Adapter } from "./adapter.js";
import { Group } from "./instances/group.js";
import { Channel } from "./instances/channel.js";
import { User } from "./instances/user.js";
import { Friend } from "./instances/friend.js";
import { GroupMember } from "./instances/groupMember.js";
import { ChannelMember } from "./instances/channelMember.js";
import { Message } from "./message.js";
import type { EventMap } from "./types.js";
import { EventFactory } from "./events/factory.js";
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
                    const event = EventFactory.create(eventType, data, this);
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
    sendChannelMessage(channelId: Id, message: Message.Content): AdapterSendResult<TAdapter, Id> {
        return this.#adapter.sendMessage({
            scene_type: "channel",
            scene_id: channelId,
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
    async getUserList(): Promise<User<Id>[]> {
        return this.#adapter.getUserList();
    }

    /** 批量获取群组列表 */
    async getGroupList(): Promise<Group<Id>[]> {
        return this.#adapter.getGroupList();
    }

    /** 批量获取频道列表 */
    async getChannelList(): Promise<Channel<Id>[]> {
        return this.#adapter.getChannelList();
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
