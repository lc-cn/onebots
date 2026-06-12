/**
 * Discord Bot 客户端
 * 轻量版实现，直接封装 Discord API，支持 Node.js 和 Cloudflare Workers
 */

import { EventEmitter } from 'events';
import { DiscordLite, GatewayIntents, type DiscordLiteOptions } from './lite/index.js';
import type { DiscordREST } from './lite/rest.js';
import type { DiscordConfig, ProxyConfig } from './types.js';
import type {
    DiscordApiUser,
    DiscordApiMessage,
    DiscordApiAttachment,
    DiscordApiGuild,
    DiscordApiChannel,
    DiscordApiGuildMember,
    DiscordRole,
    CreateMessageBody,
    EditMessageBody,
    GatewayQueryOptions,
    GatewayMemberQueryOptions,
} from './types.js';

// 带辅助方法的增强类型
export interface DiscordUser extends DiscordApiUser {
    displayAvatarURL: () => string;
    tag: string;
}

export interface DiscordMessage extends Omit<DiscordApiMessage, 'author'> {
    createdTimestamp: number;
    channel: { id: string; type: number };
    guild?: { id: string; name?: string };
    author: DiscordUser;
}

export interface DiscordAttachment extends DiscordApiAttachment {}
export interface DiscordGuild extends DiscordApiGuild {}
export interface DiscordChannel extends DiscordApiChannel {}
export interface DiscordMember extends DiscordApiGuildMember {}

/**
 * Discord Bot
 * 基于轻量客户端实现，兼容 Node.js 和 Cloudflare Workers
 */
export class DiscordBot extends EventEmitter {
    private client: DiscordLite;
    private config: DiscordConfig;
    private ready: boolean = false;
    private user: DiscordUser | null = null;
    private guilds: Map<string, DiscordGuild> = new Map();

    constructor(config: DiscordConfig) {
        super();
        this.config = config;

        // 解析 intents
        const intents = this.parseIntents(config.intents);

        const clientOptions: DiscordLiteOptions = {
            token: config.token,
            intents,
            proxy: config.proxy,
            mode: 'gateway',
        };

        this.client = new DiscordLite(clientOptions);
        this.setupEventListeners();
    }

    /**
     * 解析 intents 配置
     */
    private parseIntents(intentsConfig?: string[]): number {
        if (!intentsConfig || intentsConfig.length === 0) {
            // 默认 intents
            return (
                GatewayIntents.Guilds |
                GatewayIntents.GuildMessages |
                GatewayIntents.GuildMembers |
                GatewayIntents.GuildMessageReactions |
                GatewayIntents.DirectMessages |
                GatewayIntents.DirectMessageReactions |
                GatewayIntents.MessageContent |
                GatewayIntents.GuildVoiceStates |
                GatewayIntents.GuildPresences
            );
        }

        let result = 0;
        const intentMap: Record<string, number> = {
            'Guilds': GatewayIntents.Guilds,
            'GuildMembers': GatewayIntents.GuildMembers,
            'GuildModeration': GatewayIntents.GuildModeration,
            'GuildEmojisAndStickers': GatewayIntents.GuildEmojisAndStickers,
            'GuildIntegrations': GatewayIntents.GuildIntegrations,
            'GuildWebhooks': GatewayIntents.GuildWebhooks,
            'GuildInvites': GatewayIntents.GuildInvites,
            'GuildVoiceStates': GatewayIntents.GuildVoiceStates,
            'GuildPresences': GatewayIntents.GuildPresences,
            'GuildMessages': GatewayIntents.GuildMessages,
            'GuildMessageReactions': GatewayIntents.GuildMessageReactions,
            'GuildMessageTyping': GatewayIntents.GuildMessageTyping,
            'DirectMessages': GatewayIntents.DirectMessages,
            'DirectMessageReactions': GatewayIntents.DirectMessageReactions,
            'DirectMessageTyping': GatewayIntents.DirectMessageTyping,
            'MessageContent': GatewayIntents.MessageContent,
            'GuildScheduledEvents': GatewayIntents.GuildScheduledEvents,
        };

        for (const intent of intentsConfig) {
            if (intent in intentMap) {
                result |= intentMap[intent];
            }
        }

        return result;
    }

    /**
     * 设置事件监听器
     */
    private setupEventListeners(): void {
        this.client.on('ready', (user: unknown) => {
            this.ready = true;
            this.user = this.wrapUser(user as DiscordApiUser);
            this.emit('ready', this.user);
        });

        this.client.on('messageCreate', (message: unknown) => {
            this.emit('messageCreate', this.wrapMessage(message as DiscordApiMessage));
        });

        this.client.on('messageUpdate', (message: unknown) => {
            this.emit('messageUpdate', null, this.wrapMessage(message as DiscordApiMessage));
        });

        this.client.on('messageDelete', (data: unknown) => {
            this.emit('messageDelete', data);
        });

        this.client.on('guildCreate', (guild: unknown) => {
            const g = guild as DiscordApiGuild;
            this.guilds.set(g.id, g);
            this.emit('guildCreate', guild);
        });

        this.client.on('guildDelete', (guild: unknown) => {
            const g = guild as DiscordApiGuild;
            this.guilds.delete(g.id);
            this.emit('guildDelete', guild);
        });

        this.client.on('guildMemberAdd', (member: unknown) => {
            this.emit('guildMemberAdd', this.wrapMember(member as DiscordApiGuildMember));
        });

        this.client.on('guildMemberRemove', (member: unknown) => {
            this.emit('guildMemberRemove', this.wrapMember(member as DiscordApiGuildMember));
        });

        this.client.on('interactionCreate', (interaction: unknown) => {
            this.emit('interactionCreate', interaction);
        });

        this.client.on('error', (error: unknown) => {
            this.emit('error', error);
        });

        this.client.on('close', (code: unknown, reason: unknown) => {
            this.ready = false;
            this.emit('close', code, reason);
        });
    }

    // ============================================
    // 生命周期管理
    // ============================================

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            await this.client.start();
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.ready = false;
        this.client.stop();
        this.emit('stopped');
    }

    /**
     * 获取 Bot 是否就绪
     */
    isReady(): boolean {
        return this.ready;
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息到频道
     */
    async sendMessage(
        channelId: string,
        content: string | CreateMessageBody
    ): Promise<DiscordMessage> {
        const body = typeof content === 'string' ? { content } : content;
        const result = await this.getREST().createMessage(channelId, body);
        return this.wrapMessage(result);
    }

    /**
     * 发送私信
     */
    async sendDM(
        userId: string,
        content: string | CreateMessageBody
    ): Promise<DiscordMessage> {
        // 首先创建 DM 频道
        const dmChannel = await this.getREST().request<DiscordChannel>('/users/@me/channels', {
            method: 'POST',
            body: { recipient_id: userId },
        });

        return this.sendMessage(dmChannel.id, content);
    }

    /**
     * 发送 Embed 消息
     */
    async sendEmbed(channelId: string, embeds: CreateMessageBody['embeds']): Promise<DiscordMessage> {
        return this.sendMessage(channelId, { embeds });
    }

    /**
     * 发送带附件的消息
     */
    async sendWithAttachments(
        channelId: string,
        content: string,
        _attachments: unknown[]
    ): Promise<DiscordMessage> {
        // 轻量版暂不支持附件上传，仅发送文本
        return this.sendMessage(channelId, content);
    }

    /**
     * 编辑消息
     */
    async editMessage(channelId: string, messageId: string, content: string): Promise<DiscordMessage> {
        const result = await this.getREST().editMessage(channelId, messageId, content);
        return this.wrapMessage(result);
    }

    /**
     * 删除消息
     */
    async deleteMessage(channelId: string, messageId: string): Promise<void> {
        await this.getREST().deleteMessage(channelId, messageId);
    }

    /**
     * 获取消息
     */
    async getMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
        const result = await this.getREST().getMessage(channelId, messageId);
        return this.wrapMessage(result);
    }

    /**
     * 获取消息历史
     */
    async getMessageHistory(channelId: string, limit: number = 50, before?: string): Promise<Map<string, DiscordMessage>> {
        const query: GatewayQueryOptions = { limit };
        if (before) query.before = before;
        const messages = await this.getREST().getMessages(channelId, query);
        const map = new Map<string, DiscordMessage>();
        for (const msg of messages) {
            map.set(msg.id, this.wrapMessage(msg));
        }
        return map;
    }

    /**
     * 添加消息反应
     */
    async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
        const encodedEmoji = encodeURIComponent(emoji);
        await this.getREST().request(`/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, {
            method: 'PUT',
        });
    }

    /**
     * 移除消息反应
     */
    async removeReaction(channelId: string, messageId: string, emoji: string, userId?: string): Promise<void> {
        const encodedEmoji = encodeURIComponent(emoji);
        const target = userId || '@me';
        await this.getREST().request(`/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/${target}`, {
            method: 'DELETE',
        });
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人信息
     */
    getBotUser(): DiscordUser | null {
        return this.user;
    }

    /**
     * 获取用户信息
     */
    async getUser(userId: string): Promise<DiscordUser> {
        const result = await this.getREST().getUser(userId);
        return this.wrapUser(result);
    }

    /**
     * 获取成员信息
     */
    async getMember(guildId: string, userId: string): Promise<DiscordMember> {
        const result = await this.getREST().getGuildMember(guildId, userId);
        return this.wrapMember(result);
    }

    // ============================================
    // 服务器（Guild）相关方法
    // ============================================

    /**
     * 获取服务器列表
     */
    getGuilds(): Map<string, DiscordGuild> {
        return this.guilds;
    }

    /**
     * 获取服务器信息
     */
    async getGuild(guildId: string): Promise<DiscordGuild> {
        const result = await this.getREST().getGuild(guildId);
        this.guilds.set(result.id, result);
        return result;
    }

    /**
     * 获取服务器成员列表
     */
    async getGuildMembers(guildId: string, limit?: number): Promise<Map<string, DiscordMember>> {
        const query: GatewayMemberQueryOptions = {};
        if (limit) query.limit = limit;
        const members = await this.getREST().getGuildMembers(guildId, query);
        const map = new Map<string, DiscordMember>();
        for (const member of members) {
            if (member.user) {
                map.set(member.user.id, this.wrapMember(member));
            }
        }
        return map;
    }

    /**
     * 获取服务器成员信息
     */
    async getGuildMember(guildId: string, userId: string): Promise<DiscordMember> {
        const result = await this.getREST().getGuildMember(guildId, userId);
        return this.wrapMember(result);
    }

    /**
     * 踢出成员
     */
    async kickMember(guildId: string, userId: string, _reason?: string): Promise<void> {
        await this.getREST().removeGuildMember(guildId, userId);
    }

    /**
     * 封禁成员
     */
    async banMember(
        guildId: string,
        userId: string,
        options?: { reason?: string; deleteMessageSeconds?: number }
    ): Promise<void> {
        await this.getREST().banGuildMember(guildId, userId, {
            delete_message_seconds: options?.deleteMessageSeconds,
        });
    }

    /**
     * 解除封禁
     */
    async unbanMember(guildId: string, userId: string, _reason?: string): Promise<void> {
        await this.getREST().request(`/guilds/${guildId}/bans/${userId}`, {
            method: 'DELETE',
        });
    }

    /**
     * 禁言成员（超时）
     */
    async timeoutMember(guildId: string, userId: string, duration: number, _reason?: string): Promise<DiscordMember> {
        const until = new Date(Date.now() + duration * 1000).toISOString();
        const result = await this.getREST().request<DiscordApiGuildMember>(`/guilds/${guildId}/members/${userId}`, {
            method: 'PATCH',
            body: { communication_disabled_until: until },
        });
        return this.wrapMember(result);
    }

    /**
     * 解除禁言
     */
    async removeTimeout(guildId: string, userId: string, _reason?: string): Promise<DiscordMember> {
        const result = await this.getREST().request<DiscordApiGuildMember>(`/guilds/${guildId}/members/${userId}`, {
            method: 'PATCH',
            body: { communication_disabled_until: null },
        });
        return this.wrapMember(result);
    }

    /**
     * 修改成员昵称
     */
    async setMemberNickname(guildId: string, userId: string, nickname: string | null, _reason?: string): Promise<DiscordMember> {
        const result = await this.getREST().request<DiscordApiGuildMember>(`/guilds/${guildId}/members/${userId}`, {
            method: 'PATCH',
            body: { nick: nickname },
        });
        return this.wrapMember(result);
    }

    /**
     * 添加角色
     */
    async addRole(guildId: string, userId: string, roleId: string, _reason?: string): Promise<DiscordMember> {
        await this.getREST().request(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
            method: 'PUT',
        });
        return this.getGuildMember(guildId, userId);
    }

    /**
     * 移除角色
     */
    async removeRole(guildId: string, userId: string, roleId: string, _reason?: string): Promise<DiscordMember> {
        await this.getREST().request(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
            method: 'DELETE',
        });
        return this.getGuildMember(guildId, userId);
    }

    // ============================================
    // 频道相关方法
    // ============================================

    /**
     * 获取频道
     */
    async getChannel(channelId: string): Promise<DiscordChannel | null> {
        try {
            return await this.getREST().getChannel(channelId);
        } catch {
            return null;
        }
    }

    /**
     * 获取服务器频道列表
     */
    async getGuildChannels(guildId: string): Promise<Map<string, DiscordChannel>> {
        const channels = await this.getREST().request<DiscordApiChannel[]>(`/guilds/${guildId}/channels`);
        const map = new Map<string, DiscordChannel>();
        for (const channel of channels) {
            map.set(channel.id, channel);
        }
        return map;
    }

    /**
     * 创建文本频道
     */
    async createTextChannel(
        guildId: string,
        name: string,
        options?: { topic?: string; parent?: string; nsfw?: boolean }
    ): Promise<DiscordChannel> {
        return this.getREST().request<DiscordChannel>(`/guilds/${guildId}/channels`, {
            method: 'POST',
            body: {
                name,
                type: 0, // GUILD_TEXT
                topic: options?.topic,
                parent_id: options?.parent,
                nsfw: options?.nsfw,
            },
        });
    }

    /**
     * 删除频道
     */
    async deleteChannel(channelId: string): Promise<void> {
        await this.getREST().request(`/channels/${channelId}`, {
            method: 'DELETE',
        });
    }

    /**
     * 更新频道
     */
    async updateChannel(
        channelId: string,
        options: { name?: string; topic?: string; nsfw?: boolean; parent?: string }
    ): Promise<DiscordChannel> {
        return this.getREST().request<DiscordChannel>(`/channels/${channelId}`, {
            method: 'PATCH',
            body: {
                name: options.name,
                topic: options.topic,
                nsfw: options.nsfw,
                parent_id: options.parent,
            },
        });
    }

    // ============================================
    // 角色相关方法
    // ============================================

    /**
     * 获取服务器角色列表
     */
    async getGuildRoles(guildId: string): Promise<Map<string, DiscordRole>> {
        const roles = await this.getREST().request<DiscordRole[]>(`/guilds/${guildId}/roles`);
        const map = new Map<string, DiscordRole>();
        for (const role of roles) {
            map.set(role.id, role);
        }
        return map;
    }

    /**
     * 获取角色信息
     */
    async getRole(guildId: string, roleId: string): Promise<DiscordRole | null> {
        const roles = await this.getGuildRoles(guildId);
        return roles.get(roleId) || null;
    }

    /**
     * 创建角色
     */
    async createRole(
        guildId: string,
        options: { name: string; color?: number; hoist?: boolean; mentionable?: boolean; permissions?: bigint }
    ): Promise<DiscordRole> {
        return this.getREST().request<DiscordRole>(`/guilds/${guildId}/roles`, {
            method: 'POST',
            body: {
                name: options.name,
                color: options.color,
                hoist: options.hoist,
                mentionable: options.mentionable,
                permissions: options.permissions?.toString(),
            },
        });
    }

    /**
     * 删除角色
     */
    async deleteRole(guildId: string, roleId: string): Promise<void> {
        await this.getREST().request(`/guilds/${guildId}/roles/${roleId}`, {
            method: 'DELETE',
        });
    }

    // ============================================
    // 工具方法
    // ============================================

    /**
     * 获取 REST 客户端
     */
    getREST(): DiscordREST {
        return this.client.getREST();
    }

    /**
     * 获取原始 Discord Lite 客户端
     */
    getClient(): DiscordLite {
        return this.client;
    }

    /**
     * 包装用户对象
     */
    private wrapUser(user: DiscordApiUser): DiscordUser {
        return {
            ...user,
            displayAvatarURL: () => {
                if (user.avatar) {
                    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
                }
                const defaultAvatar = parseInt(user.discriminator || '0') % 5;
                return `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`;
            },
            tag: `${user.username}#${user.discriminator || '0'}`,
        };
    }

    /**
     * 包装成员对象
     */
    private wrapMember(member: DiscordApiGuildMember): DiscordMember {
        return {
            ...member,
            user: member.user ? this.wrapUser(member.user) : undefined,
        } as DiscordMember;
    }

    /**
     * 包装消息对象
     */
    private wrapMessage(message: DiscordApiMessage): DiscordMessage {
        return {
            ...message,
            createdTimestamp: new Date(message.timestamp).getTime(),
            channel: { id: message.channel_id, type: message.guild_id ? 0 : 1 },
            guild: message.guild_id ? { id: message.guild_id } : undefined,
            author: this.wrapUser(message.author),
        };
    }
}
