/**
 * KOOK (开黑了) Bot 客户端
 * 基于 kook-client 封装
 */
import { EventEmitter } from 'events';
import {Client,ChannelMessageEvent,PrivateMessageEvent} from 'kook-client';
import type { RouterContext, Next } from 'onebots';
import type {
    KookConfig,
    KookUser,
    KookGuild,
    KookChannel,
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
    private transformChannelEvent(event: ChannelMessageEvent): any {
        const payload = (event as any).payload || {};
        const extra = payload.extra || {};
        return {
            type: payload.type || extra.type || 9,
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
    private transformPrivateEvent(event: PrivateMessageEvent): any {
        const payload = (event as any).payload || {};
        const extra = payload.extra || {};
        return {
            type: payload.type || extra.type || 9,
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
    async getGuildList(page?: number, pageSize?: number): Promise<{ items: KookGuild[]; meta: any }> {
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
    async getChannelList(guildId: string, type?: 1 | 2, page?: number, pageSize?: number): Promise<{ items: KookChannel[]; meta: any }> {
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
    async sendChannelMessage(channelId: string, content: string, quoteId?: string): Promise<any> {
        const channel = this.client.pickChannel(channelId);
        const quote = quoteId ? { message_id: quoteId } : undefined;
        return await channel.sendMsg(content, quote);
    }

    /**
     * 发送私聊消息
     */
    async sendDirectMessage(userId: string, content: string, quoteId?: string): Promise<any> {
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
            });
            return (result as any)?.code === 0;
        } catch {
            // 频道消息删除失败，尝试私聊消息删除
            const result = await this.client.request.post('/v3/direct-message/delete', {
                msg_id: messageId,
            });
            return (result as any)?.code === 0;
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
    async getMessage(channelId: string, messageId: string): Promise<any> {
        const channel = this.client.pickChannel(channelId);
        return await channel.getMsg(messageId);
    }

    /**
     * 获取聊天历史
     */
    async getChatHistory(channelId: string, messageId?: string, limit: number = 50): Promise<any[]> {
        const channel = this.client.pickChannel(channelId);
        return await channel.getChatHistory(messageId, limit);
    }

    /**
     * 获取用户私聊会话列表（KOOK 不支持，返回空数组）
     */
    async getUserChatList(page: number = 1, pageSize: number = 50): Promise<{ items: any[]; meta: any }> {
        // KOOK 不提供私聊会话列表 API，返回空数组
        return { items: [], meta: { page_total: 1 } };
    }

    /**
     * 获取频道用户列表
     */
    async getChannelUserList(channelId: string): Promise<{ items: KookUser[]; meta: any }> {
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
        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (slowMode !== undefined) updateData.slow_mode = slowMode;
        await channel.update(updateData);
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
    ): Promise<{ items: KookUser[]; meta: any }> {
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

    private transformUser(user: any): KookUser {
        return {
            id: user.id,
            username: user.username || '',
            nickname: user.nickname,
            identify_num: user.identify_num || '',
            online: user.online || false,
            bot: user.bot || false,
            status: user.status || 0,
            avatar: user.avatar || '',
            vip_avatar: user.vip_avatar,
            mobile_verified: user.mobile_verified,
            roles: user.roles,
            joined_at: user.joined_at,
            active_time: user.active_time,
        };
    }

    private transformGuild(guild: any): KookGuild {
        return {
            id: guild.id,
            name: guild.name,
            topic: guild.topic || '',
            user_id: guild.user_id || '',
            icon: guild.icon || '',
            notify_type: guild.notify_type || 0,
            region: guild.region || '',
            enable_open: guild.enable_open || false,
            open_id: guild.open_id || '',
            default_channel_id: guild.default_channel_id || '',
            welcome_channel_id: guild.welcome_channel_id || '',
            roles: guild.roles,
            channels: guild.channels,
        };
    }

    private transformChannel(channel: any): KookChannel {
        return {
            id: channel.id,
            name: channel.name,
            user_id: channel.user_id || '',
            guild_id: channel.guild_id || '',
            topic: channel.topic || '',
            is_category: channel.is_category || false,
            parent_id: channel.parent_id || '',
            level: channel.level || 0,
            slow_mode: channel.slow_mode || 0,
            type: channel.type || 1,
            permission_overwrites: channel.permission_overwrites || [],
            permission_users: channel.permission_users || [],
            permission_sync: channel.permission_sync || 0,
            has_password: channel.has_password || false,
        };
    }

    /**
     * 获取 kook-client 实例（用于高级操作）
     */
    getClient(): Client {
        return this.client;
    }
}
