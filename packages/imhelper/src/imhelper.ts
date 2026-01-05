import { EventEmitter } from 'events';
import { Adapter } from './adapter.js';
import { Group } from './instances/group.js';
import { Channel } from './instances/channel.js';
import { User } from './instances/user.js';
import { Friend } from './instances/friend.js';
import { GroupMember } from './instances/groupMember.js';
import { ChannelMember } from './instances/channelMember.js';
import { Message } from './message.js';
import { EventMap } from './types.js';
import { EventFactory } from './events/factory.js';
type GroupMemberMap<Id extends string | number> = Map<Id, GroupMember.Data<Id>>;
type ChannelMemberMap<Id extends string | number> = Map<Id, ChannelMember.Data<Id>>;
export class ImHelper<Id extends string | number=string|number> extends EventEmitter<EventMap<Id>> {
    #adapter: Adapter<Id>;
    $userMap: Map<Id, User.Data<Id>> = new Map<Id, User.Data<Id>>();
    $friendMap: Map<Id, Friend.Data<Id>> = new Map<Id, Friend.Data<Id>>();
    $groupMap: Map<Id, Group.Data<Id>> = new Map<Id, Group.Data<Id>>();
    $groupMemberMap: Map<Id, GroupMemberMap<Id>> = new Map<Id, GroupMemberMap<Id>>();
    $channelMap: Map<Id, Channel.Data<Id>> = new Map<Id, Channel.Data<Id>>();
    $channelMemberMap: Map<Id, ChannelMemberMap<Id>> = new Map<Id, ChannelMemberMap<Id>>();
    pickUser=User.from.bind(this) as typeof User.from;
    pickFriend=Friend.from.bind(this) as typeof Friend.from;    
    pickGroup=Group.from.bind(this) as typeof Group.from;
    pickChannel=Channel.from.bind(this) as typeof Channel.from;
    pickGroupMember=GroupMember.from.bind(this) as typeof GroupMember.from;
    pickChannelMember=ChannelMember.from.bind(this) as typeof ChannelMember.from;
    constructor(adapter: Adapter<Id>) {
        super();
        this.#adapter = adapter;
        
        // 从 EventFactory 自动获取所有支持的事件类型
        const eventTypes = EventFactory.getSupportedEventTypes<Id>();

        // 统一处理事件转发
        for (const eventType of eventTypes) {
            adapter.on(eventType, (data: any) => {
                try {
                    const event = EventFactory.create(eventType, data, this);
                    this.emit(eventType, event as any);
                } catch (error) {
                    // 记录错误但不中断程序
                    console.error(`[ImHelper] Failed to create event ${String(eventType)}:`, error);
                }
            });
        }
        
        // 转发 adapter 的原始事件（使用类型断言，因为 'event' 不在 EventMap 中）
        adapter.on('event' as keyof Adapter.EventMap<Id>, (event: unknown) => {
            this.emit('event' as keyof EventMap<Id>, event as any);
        });
    }
    get adapter() {
        return this.#adapter;
    }
    sendPrivateMessage(userId: Id, message: Message.Content) {
        return this.#adapter.sendMessage({
            scene_type: 'private',
            scene_id: userId,
            message: message,
        });
    }
    sendGroupMessage(groupId: Id, message: Message.Content) {
        return this.#adapter.sendMessage({
            scene_type: 'group',
            scene_id: groupId,
            message: message,
        });
    }
    sendChannelMessage(channelId: Id, message: Message.Content) {
        return this.#adapter.sendMessage({
            scene_type: 'channel',
            scene_id: channelId,
            message: message,
        });
    }
    async start(port?: number): Promise<void> {
        return this.#adapter.start?.(port);
    }

    async stop(): Promise<void> {
        return this.#adapter.stop?.();
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
    async uploadFile(file: File | Blob | Buffer, filename?: string): Promise<{ file_id: Id; url?: string }> {
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
    async approveFriendRequest(request_id: Id, approve: boolean = true, comment?: string): Promise<void> {
        return this.#adapter.approveFriendRequest(request_id, approve, comment);
    }
    
    /** 处理加群请求 */
    async approveGroupRequest(request_id: Id, approve: boolean = true, reason?: string): Promise<void> {
        return this.#adapter.approveGroupRequest(request_id, approve, reason);
    }
}