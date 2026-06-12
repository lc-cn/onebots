/**
 * KOOK (开黑了) Bot 客户端
 * 基于 kook-client 封装
 */
import { EventEmitter } from 'events';
import {Client,ChannelMessageEvent,PrivateMessageEvent} from 'kook-client';
import type { User, Guild, Channel, Message } from 'kook-client';
import type { RouterContext, Next } from 'onebots';
import type {
    KookConfig,
    KookUser,
    KookGuild,
    KookChannel,
    KookApiResponse,
    KookEvent,
    KookEventExtra,
    KookTransformedChannelEvent,
    KookTransformedPrivateEvent,
    KookSimplePageMeta,
    KookChannelUpdateData,
    KookChannelMessage,
    KookUserChat,
    KookRole,
} from './types.js';

export class KookBot extends EventEmitter {
    private client: Client;
    private config: KookConfig;

    constructor(config: KookConfig) {
        super();
        this.config = config;
        
        // 创建 kook-client 实例
        this.client = new Client({
            token: config.token,
            mode: config.mode || 'websocket',
            verify_token: config.verifyToken,
            encrypt_key: config.encryptKey,
            ignore: 'bot', // 忽略机器人消息
            logLevel: 'warn', // 使用 warn 级别，避免过多日志
        });

        // 转发 kook-client 的事件
        this.setupEventForwarding();
    }

    /**
     * 设置事件转发
     */
    private setupEventForwarding(): void {
        // 转发 ready 事件
        this.client.on('ready', () => {
            this.emit('ready');
        });

        // 转发频道消息事件
        this.client.on('message.channel', (event: ChannelMessageEvent) => {
            this.emit('channel_message', this.transformChannelEvent(event));
        });

        // 转发私聊消息事件
        this.client.on('message.private', (event: PrivateMessageEvent) => {
            this.emit('direct_message', this.transformPrivateEvent(event));
        });

        // 转发通用消息事件
        this.client.on('message', (event: ChannelMessageEvent | PrivateMessageEvent) => {
            if (event instanceof ChannelMessageEvent) {
                this.emit('message', this.transformChannelEvent(event));
            } else {
                this.emit('message', this.transformPrivateEvent(event));
            }
        });

        // 转发错误事件
        this.client.on('error', (error) => {
            this.emit('error', error);
        });
    }

    /**
     * 转换频道消息事件为内部格式
     */
    private transformChannelEvent(event: ChannelMessageEvent): KookTransformedChannelEvent {
        const payload = (event as { payload?: { extra?: KookEventExtra; type?: number; content?: string; msg_id?: string; msg_timestamp?: number } }).payload || {};
        const extra = payload.extra || {} as KookEventExtra;
        return {
            type: (payload.type as number) || (extra.type as number) || 9,
            channel_type: 'GROUP',
            author_id: event.author_id,
            content: event.raw_message || payload.content || '',
            msg_id: event.message_id || payload.msg_id || '',
            msg_timestamp: event.timestamp || payload.msg_timestamp || Date.now(),
            channel_id: event.channel_id,
            guild_id: extra.guild_id || '',
            extra: extra,
            // 保留原始事件引用
            _original: event,
        };
    }

    /**
     * 转换私聊消息事件为内部格式
     */
    private transformPrivateEvent(event: PrivateMessageEvent): KookTransformedPrivateEvent {
        const payload = (event as { payload?: { extra?: KookEventExtra; type?: number; content?: string; msg_id?: string; msg_timestamp?: number } }).payload || {};
        const extra = payload.extra || {} as KookEventExtra;
        return {
            type: (payload.type as number) || (extra.type as number) || 9,
            channel_type: 'PERSON',
            author_id: event.author_id,
            content: event.raw_message || payload.content || '',
            msg_id: event.message_id || payload.msg_id || '',
            msg_timestamp: event.timestamp || payload.msg_timestamp || Date.now(),
            code: extra.code || '',
            extra: extra,
            // 保留原始事件引用
            _original: event,
        };
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            await this.client.connect();
            // connect() 会自动调用 init()，所以不需要手动调用
            this.emit('ready');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        try {
            await this.client.disconnect();
            this.emit('stopped');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 处理 Webhook 请求（Webhook 模式下由 kook-client 内部处理）
     * 这个方法保留用于兼容，但实际处理由 kook-client 完成
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        // kook-client 的 webhook receiver 是空的，需要我们自己实现
        // 但为了保持接口一致性，这里保留方法签名
        await next();
    }

    /**
     * 获取缓存的用户信息
     */
    getCachedMe(): KookUser | null {
        if (!this.client.self_id) return null;
        
        return {
            id: this.client.self_id,
            username: this.client.nickname || '',
            nickname: this.client.nickname,
            identify_num: '',
            online: true,
            bot: true,
            status: 0,
            avatar: '',
        };
    }

    // ============================================
    // API 方法代理到 kook-client
    // ============================================

    /**
     * 获取当前用户信息
     */
    async getMe(): Promise<KookUser> {
        const userInfo = await this.client.getSelfInfo();
        return this.transformUser(userInfo);
    }

    /**
     * 获取用户信息
     */
    async getUser(userId: string, guildId?: string): Promise<KookUser> {
        const user = await this.client.pickUser(userId);
        return this.transformUser(user.info);
    }

    /**
     * 获取服务器列表
     */
    async getGuildList(page?: number, pageSize?: number): Promise<{ items: KookGuild[]; meta: KookSimplePageMeta }> {
        const guilds = await this.client.getGuildList();
        return {
            items: guilds.map(g => this.transformGuild(g)),
            meta: { page_total: 1 },
        };
    }

    /**
     * 获取服务器详情
     */
    async getGuild(guildId: string): Promise<KookGuild> {
        const guild = await this.client.getGuildInfo(guildId);
        return this.transformGuild(guild);
    }

    /**
     * 获取频道列表
     */
    async getChannelList(guildId: string, type?: 1 | 2, page?: number, pageSize?: number): Promise<{ items: KookChannel[]; meta: KookSimplePageMeta }> {
        const channels = await this.client.getChannelList(guildId);
        return {
            items: channels.map(c => this.transformChannel(c)),
            meta: { page_total: 1 },
        };
    }

    /**
     * 获取频道详情
     */
    async getChannel(channelId: string): Promise<KookChannel> {
        const channel = this.client.pickChannel(channelId);
        return this.transformChannel(channel.info);
    }

    /**
     * 发送频道消息
     */
    async sendChannelMessage(channelId: string, content: string, quoteId?: string): Promise<Message.Ret> {
        const channel = this.client.pickChannel(channelId);
        const quote = quoteId ? { message_id: quoteId } : undefined;
        return await channel.sendMsg(content, quote);
    }

    /**
     * 发送私聊消息
     */
    async sendDirectMessage(userId: string, content: string, quoteId?: string): Promise<Message.Ret> {
        const user = this.client.pickUser(userId);
        const quote = quoteId ? { message_id: quoteId } : undefined;
        return await user.sendMsg(content, quote);
    }

    /**
     * 删除消息
     */
    async deleteMessage(channelId: string, messageId: string): Promise<boolean> {
        const channel = this.client.pickChannel(channelId);
        return await channel.recallMsg(messageId);
    }

    /**
     * 仅通过消息 ID 删除消息（不需要 channelId）
     * 先尝试频道消息删除，失败后尝试私聊消息删除
     */
    async deleteMessageById(messageId: string): Promise<boolean> {
        try {
            const result = await this.client.request.post('/v3/message/delete', {
                msg_id: messageId,
            }) as KookApiResponse;
            if (result.code !== 0) {
                throw new Error(`Channel message delete failed: ${result.message} (code: ${result.code})`);
            }
            return true;
        } catch (channelDeleteError) {
            // 频道消息删除失败，尝试私聊消息删除
            try {
                const result = await this.client.request.post('/v3/direct-message/delete', {
                    msg_id: messageId,
                }) as KookApiResponse;
                return result.code === 0;
            } catch (directMessageDeleteError) {
                const error = new Error(
                    `Failed to delete message ${messageId} via both channel and direct-message APIs.`,
                    { cause: channelDeleteError },
                ) as Error & { directMessageDeleteError?: unknown };
                error.directMessageDeleteError = directMessageDeleteError;
                throw error;
            }
        }
    }

    /**
     * 更新消息
     */
    async updateMessage(channelId: string, messageId: string, content: string): Promise<boolean> {
        const channel = this.client.pickChannel(channelId);
        return await channel.updateMsg(messageId, content);
    }

    /**
     * 获取消息
     */
    async getMessage(channelId: string, messageId: string): Promise<Message> {
        const channel = this.client.pickChannel(channelId);
        return await channel.getMsg(messageId);
    }

    /**
     * 获取聊天历史
     */
    async getChatHistory(channelId: string, messageId?: string, limit: number = 50): Promise<Message[]> {
        const channel = this.client.pickChannel(channelId);
        return await channel.getChatHistory(messageId, limit);
    }

    /**
     * 获取用户私聊会话列表（KOOK 不支持，返回空数组）
     */
    async getUserChatList(page: number = 1, pageSize: number = 50): Promise<{ items: KookUserChat[]; meta: KookSimplePageMeta }> {
        // KOOK 不提供私聊会话列表 API，返回空数组
        return { items: [], meta: { page_total: 1 } };
    }

    /**
     * 获取频道用户列表
     */
    async getChannelUserList(channelId: string): Promise<{ items: KookUser[]; meta: KookSimplePageMeta }> {
        const channel = this.client.pickChannel(channelId);
        const users = await channel.getUserList();
        return {
            items: users.map(u => this.transformUser(u)),
            meta: { page_total: 1 },
        };
    }

    /**
     * 创建频道
     */
    async createChannel(guildId: string, name: string, type?: 1 | 2, parentId?: string): Promise<KookChannel> {
        // kook-client 没有直接的 createChannel，需要通过 API
        const response = await this.client.request.post('/v3/channel/create', {
            guild_id: guildId,
            name,
            type,
            parent_id: parentId,
        });
        return this.transformChannel(response.data);
    }

    /**
     * 更新频道
     */
    async updateChannel(channelId: string, name?: string, topic?: string, slowMode?: number): Promise<KookChannel> {
        const channel = this.client.pickChannel(channelId);
        const updateData = {} as Omit<Channel.Info, 'id'> & { slow_mode?: number };
        if (name !== undefined) updateData.name = name;
        if (slowMode !== undefined) updateData.slow_mode = slowMode;
        await channel.update(updateData as Omit<Channel.Info, 'id'>);
        return this.transformChannel(channel.info);
    }

    /**
     * 删除频道
     */
    async deleteChannel(channelId: string): Promise<void> {
        const channel = this.client.pickChannel(channelId);
        await channel.delete();
    }

    /**
     * 获取服务器成员列表
     */
    async getGuildMemberList(
        guildId: string,
        channelId?: string,
        search?: string,
        roleId?: number,
        mobileVerified?: boolean,
        activeTime?: number,
        joinedAt?: number,
        page?: number,
        pageSize?: number
    ): Promise<{ items: KookUser[]; meta: KookSimplePageMeta }> {
        const users = await this.client.getGuildUserList(guildId, channelId);
        return {
            items: users.map(u => this.transformUser(u)),
            meta: { page_total: 1 },
        };
    }

    /**
     * 离开服务器
     */
    async leaveGuild(guildId: string): Promise<void> {
        // kook-client 没有直接的 leaveGuild 方法，需要通过 API
        await this.client.request.post('/v3/guild/leave', {
            guild_id: guildId,
        });
    }

    /**
     * 踢出服务器成员
     */
    async kickGuildMember(guildId: string, userId: string): Promise<void> {
        // kook-client 没有直接的 kickGuildMember 方法，需要通过 API
        await this.client.request.post('/v3/guild/kickout', {
            guild_id: guildId,
            target_id: userId,
        });
    }

    /**
     * 设置服务器昵称
     */
    async setGuildNickname(guildId: string, nickname?: string, userId?: string): Promise<void> {
        // kook-client 没有直接的 setGuildNickname 方法，需要通过 API
        await this.client.request.post('/v3/guild/nickname', {
            guild_id: guildId,
            nickname,
            user_id: userId,
        });
    }

    /**
     * 上传文件
     */
    async uploadAsset(fileBuffer: Buffer, filename: string): Promise<{ url: string }> {
        // kook-client 使用 uploadMedia 方法
        const url = await this.client.uploadMedia(fileBuffer);
        return { url };
    }

    // ============================================
    // 类型转换方法
    // ============================================

    private transformUser(user: Partial<User.Info> & { id: string }): KookUser {
        const ext = user as Partial<User.Info> & { id: string; joined_at?: number; active_time?: number };
        return {
            id: ext.id,
            username: ext.username || '',
            nickname: ext.nickname,
            identify_num: ext.identify_num || '',
            online: ext.online || false,
            bot: ext.bot || false,
            status: ext.status || 0,
            avatar: ext.avatar || '',
            vip_avatar: ext.vip_avatar,
            mobile_verified: ext.mobile_verified,
            roles: ext.roles,
            joined_at: ext.joined_at,
            active_time: ext.active_time,
        };
    }

    private transformGuild(guild: Partial<Guild.Info> & { id: string; name: string }): KookGuild {
        const ext = guild as Partial<Guild.Info> & { id: string; name: string; roles?: KookRole[]; channels?: KookChannel[] };
        return {
            id: ext.id,
            name: ext.name,
            topic: ext.topic || '',
            user_id: ext.user_id || '',
            icon: ext.icon || '',
            notify_type: (ext.notify_type as number) || 0,
            region: ext.region || '',
            enable_open: Boolean(ext.enable_open),
            open_id: String(ext.open_id ?? ''),
            default_channel_id: ext.default_channel_id || '',
            welcome_channel_id: ext.welcome_channel_id || '',
            roles: ext.roles,
            channels: ext.channels,
        };
    }

    private transformChannel(channel: Partial<Channel.Info> & { id: string; name: string }): KookChannel {
        const ext = channel as Partial<Channel.Info> & { id: string; name: string; guild_id?: string; topic?: string; slow_mode?: number; permission_overwrites?: KookChannel['permission_overwrites']; permission_users?: KookChannel['permission_users']; permission_sync?: number; has_password?: boolean };
        return {
            id: ext.id,
            name: ext.name,
            user_id: ext.user_id || '',
            guild_id: ext.guild_id || '',
            topic: ext.topic || '',
            is_category: ext.is_category || false,
            parent_id: ext.parent_id || '',
            level: ext.level || 0,
            slow_mode: ext.slow_mode || 0,
            type: (ext.type as unknown as number) || 1,
            permission_overwrites: ext.permission_overwrites || [],
            permission_users: ext.permission_users || [],
            permission_sync: ext.permission_sync || 0,
            has_password: ext.has_password || false,
        };
    }

    /**
     * 获取 kook-client 实例（用于高级操作）
     */
    getClient(): Client {
        return this.client;
    }
}
