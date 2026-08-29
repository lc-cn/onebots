/**
 * Discord Bot 客户端
 * 轻量版实现，直接封装 Discord API，支持 Node.js 和 Cloudflare Workers
 */

import { EventEmitter } from "node:events";
import { DiscordLite, type DiscordLiteOptions } from "./lite/index.js";
import type { DiscordREST } from "./lite/rest.js";
import type { DiscordConfig } from "./types.js";
import type {
    DiscordApiUser,
    DiscordApiMessage,
    DiscordApiGuild,
    DiscordApiChannel,
    DiscordApiGuildMember,
    DiscordRole,
    CreateMessageBody,
    GatewayQueryOptions,
    GatewayMemberQueryOptions,
} from "./types.js";
import {
    wrapDiscordMember,
    wrapDiscordMessage,
    wrapDiscordUser,
    type DiscordChannel,
    type DiscordGuild,
    type DiscordMember,
    type DiscordMessage,
    type DiscordUser,
} from "./bot-model.js";
import { resolveDiscordIntents } from "./intents.js";
import { materializeDiscordFile, type DiscordFileInput } from "./media.js";
export type {
    DiscordAttachment,
    DiscordChannel,
    DiscordGuild,
    DiscordMember,
    DiscordMessage,
    DiscordUser,
} from "./bot-model.js";
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
        const intents = resolveDiscordIntents(config.intents);
        const clientOptions: DiscordLiteOptions = {
            token: config.token,
            intents,
            proxy: config.proxy,
            mode: "gateway",
        };
        this.client = new DiscordLite(clientOptions);
        this.setupEventListeners();
    }
    private setupEventListeners(): void {
        this.client.on("ready", (user: unknown) => {
            this.ready = true;
            this.user = wrapDiscordUser(user as DiscordApiUser);
            this.emit("ready", this.user);
        });
        this.client.on("messageCreate", (message: unknown) => {
            this.emit("messageCreate", wrapDiscordMessage(message as DiscordApiMessage));
        });
        this.client.on("messageUpdate", (message: unknown) => {
            this.emit("messageUpdate", null, wrapDiscordMessage(message as DiscordApiMessage));
        });
        this.client.on("messageDelete", (data: unknown) => {
            this.emit("messageDelete", data);
        });
        this.client.on("guildCreate", (guild: unknown) => {
            const g = guild as DiscordApiGuild;
            this.guilds.set(g.id, g);
            this.emit("guildCreate", guild);
        });
        this.client.on("guildDelete", (guild: unknown) => {
            const g = guild as DiscordApiGuild;
            this.guilds.delete(g.id);
            this.emit("guildDelete", guild);
        });
        this.client.on("guildMemberAdd", (member: unknown) => {
            this.emit("guildMemberAdd", wrapDiscordMember(member as DiscordApiGuildMember));
        });
        this.client.on("guildMemberRemove", (member: unknown) => {
            this.emit("guildMemberRemove", wrapDiscordMember(member as DiscordApiGuildMember));
        });
        this.client.on("interactionCreate", (interaction: unknown) => {
            this.emit("interactionCreate", interaction);
        });
        this.client.on("dispatch", (eventName: unknown, data: unknown) => {
            this.emit("dispatch", String(eventName), data);
        });
        this.client.on("error", (error: unknown) => {
            this.emit("error", error);
        });
        this.client.on("close", (code: unknown, reason: unknown) => {
            this.ready = false;
            this.emit("close", code, reason);
        });
    }
    // 生命周期管理
    async start(): Promise<void> {
        try {
            await this.client.start();
        } catch (error) {
            this.emit("error", error);
            throw error;
        }
    }
    async stop(): Promise<void> {
        this.ready = false;
        this.client.stop();
        this.emit("stopped");
    }
    isReady(): boolean {
        return this.ready;
    }
    // 消息相关方法
    async sendMessage(
        channelId: string,
        content: string | CreateMessageBody,
        files: DiscordFileInput[] = [],
    ): Promise<DiscordMessage> {
        const body = typeof content === "string" ? { content } : content;
        const uploads = await Promise.all(files.map(materializeDiscordFile));
        const result = await this.getREST().createMessage(channelId, body, uploads);
        return wrapDiscordMessage(result);
    }
    async sendDM(
        userId: string,
        content: string | CreateMessageBody,
        files: DiscordFileInput[] = [],
    ): Promise<DiscordMessage> {
        // 首先创建 DM 频道
        const dmChannel = await this.getREST().request<DiscordChannel>("/users/@me/channels", {
            method: "POST",
            body: { recipient_id: userId },
        });
        return this.sendMessage(dmChannel.id, content, files);
    }
    async sendEmbed(
        channelId: string,
        embeds: CreateMessageBody["embeds"],
    ): Promise<DiscordMessage> {
        return this.sendMessage(channelId, { embeds });
    }
    async sendWithAttachments(
        channelId: string,
        content: string,
        attachments: DiscordFileInput[],
    ): Promise<DiscordMessage> {
        return this.sendMessage(channelId, content, attachments);
    }
    async editMessage(
        channelId: string,
        messageId: string,
        content: string,
    ): Promise<DiscordMessage> {
        const result = await this.getREST().editMessage(channelId, messageId, content);
        return wrapDiscordMessage(result);
    }

    async deleteMessage(channelId: string, messageId: string): Promise<void> {
        await this.getREST().deleteMessage(channelId, messageId);
    }

    async getMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
        const result = await this.getREST().getMessage(channelId, messageId);
        return wrapDiscordMessage(result);
    }

    async getMessageHistory(
        channelId: string,
        limit: number = 50,
        before?: string,
    ): Promise<Map<string, DiscordMessage>> {
        const query: GatewayQueryOptions = { limit };
        if (before) query.before = before;
        const messages = await this.getREST().getMessages(channelId, query);
        const map = new Map<string, DiscordMessage>();
        for (const msg of messages) {
            map.set(msg.id, wrapDiscordMessage(msg));
        }
        return map;
    }

    async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
        const encodedEmoji = encodeURIComponent(emoji);
        await this.getREST().request(
            `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
            {
                method: "PUT",
            },
        );
    }

    async removeReaction(
        channelId: string,
        messageId: string,
        emoji: string,
        userId?: string,
    ): Promise<void> {
        const encodedEmoji = encodeURIComponent(emoji);
        const target = userId || "@me";
        await this.getREST().request(
            `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/${target}`,
            {
                method: "DELETE",
            },
        );
    }

    // 用户相关方法

    getBotUser(): DiscordUser | null {
        return this.user;
    }

    async getUser(userId: string): Promise<DiscordUser> {
        const result = await this.getREST().getUser(userId);
        return wrapDiscordUser(result);
    }

    async getMember(guildId: string, userId: string): Promise<DiscordMember> {
        const result = await this.getREST().getGuildMember(guildId, userId);
        return wrapDiscordMember(result);
    }

    // 服务器（Guild）相关方法

    getGuilds(): Map<string, DiscordGuild> {
        return this.guilds;
    }

    async getGuild(guildId: string): Promise<DiscordGuild> {
        const result = await this.getREST().getGuild(guildId);
        this.guilds.set(result.id, result);
        return result;
    }

    async getGuildMembers(guildId: string, limit?: number): Promise<Map<string, DiscordMember>> {
        const query: GatewayMemberQueryOptions = {};
        if (limit) query.limit = limit;
        const members = await this.getREST().getGuildMembers(guildId, query);
        const map = new Map<string, DiscordMember>();
        for (const member of members) {
            if (member.user) {
                map.set(member.user.id, wrapDiscordMember(member));
            }
        }
        return map;
    }

    async getGuildMember(guildId: string, userId: string): Promise<DiscordMember> {
        const result = await this.getREST().getGuildMember(guildId, userId);
        return wrapDiscordMember(result);
    }

    async kickMember(guildId: string, userId: string, _reason?: string): Promise<void> {
        await this.getREST().removeGuildMember(guildId, userId);
    }

    async banMember(
        guildId: string,
        userId: string,
        options?: { reason?: string; deleteMessageSeconds?: number },
    ): Promise<void> {
        await this.getREST().banGuildMember(guildId, userId, {
            delete_message_seconds: options?.deleteMessageSeconds,
        });
    }

    async unbanMember(guildId: string, userId: string, _reason?: string): Promise<void> {
        await this.getREST().request(`/guilds/${guildId}/bans/${userId}`, {
            method: "DELETE",
        });
    }

    async timeoutMember(
        guildId: string,
        userId: string,
        duration: number,
        _reason?: string,
    ): Promise<DiscordMember> {
        const until = new Date(Date.now() + duration * 1000).toISOString();
        const result = await this.getREST().request<DiscordApiGuildMember>(
            `/guilds/${guildId}/members/${userId}`,
            {
                method: "PATCH",
                body: { communication_disabled_until: until },
            },
        );
        return wrapDiscordMember(result);
    }

    async removeTimeout(guildId: string, userId: string, _reason?: string): Promise<DiscordMember> {
        const result = await this.getREST().request<DiscordApiGuildMember>(
            `/guilds/${guildId}/members/${userId}`,
            {
                method: "PATCH",
                body: { communication_disabled_until: null },
            },
        );
        return wrapDiscordMember(result);
    }

    async setMemberNickname(
        guildId: string,
        userId: string,
        nickname: string | null,
        _reason?: string,
    ): Promise<DiscordMember> {
        const result = await this.getREST().request<DiscordApiGuildMember>(
            `/guilds/${guildId}/members/${userId}`,
            {
                method: "PATCH",
                body: { nick: nickname },
            },
        );
        return wrapDiscordMember(result);
    }

    async addRole(
        guildId: string,
        userId: string,
        roleId: string,
        _reason?: string,
    ): Promise<DiscordMember> {
        await this.getREST().request(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
            method: "PUT",
        });
        return this.getGuildMember(guildId, userId);
    }

    async removeRole(
        guildId: string,
        userId: string,
        roleId: string,
        _reason?: string,
    ): Promise<DiscordMember> {
        await this.getREST().request(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
            method: "DELETE",
        });
        return this.getGuildMember(guildId, userId);
    }

    // 频道相关方法

    async getChannel(channelId: string): Promise<DiscordChannel | null> {
        try {
            return await this.getREST().getChannel(channelId);
        } catch {
            return null;
        }
    }

    async getGuildChannels(guildId: string): Promise<Map<string, DiscordChannel>> {
        const channels = await this.getREST().request<DiscordApiChannel[]>(
            `/guilds/${guildId}/channels`,
        );
        const map = new Map<string, DiscordChannel>();
        for (const channel of channels) {
            map.set(channel.id, channel);
        }
        return map;
    }

    async createTextChannel(
        guildId: string,
        name: string,
        options?: { topic?: string; parent?: string; nsfw?: boolean },
    ): Promise<DiscordChannel> {
        return this.getREST().request<DiscordChannel>(`/guilds/${guildId}/channels`, {
            method: "POST",
            body: {
                name,
                type: 0, // GUILD_TEXT
                topic: options?.topic,
                parent_id: options?.parent,
                nsfw: options?.nsfw,
            },
        });
    }

    async deleteChannel(channelId: string): Promise<void> {
        await this.getREST().request(`/channels/${channelId}`, {
            method: "DELETE",
        });
    }

    async updateChannel(
        channelId: string,
        options: { name?: string; topic?: string; nsfw?: boolean; parent?: string },
    ): Promise<DiscordChannel> {
        return this.getREST().request<DiscordChannel>(`/channels/${channelId}`, {
            method: "PATCH",
            body: {
                name: options.name,
                topic: options.topic,
                nsfw: options.nsfw,
                parent_id: options.parent,
            },
        });
    }

    // 角色相关方法

    async getGuildRoles(guildId: string): Promise<Map<string, DiscordRole>> {
        const roles = await this.getREST().request<DiscordRole[]>(`/guilds/${guildId}/roles`);
        const map = new Map<string, DiscordRole>();
        for (const role of roles) {
            map.set(role.id, role);
        }
        return map;
    }

    async getRole(guildId: string, roleId: string): Promise<DiscordRole | null> {
        const roles = await this.getGuildRoles(guildId);
        return roles.get(roleId) || null;
    }

    async createRole(
        guildId: string,
        options: {
            name: string;
            color?: number;
            hoist?: boolean;
            mentionable?: boolean;
            permissions?: bigint;
        },
    ): Promise<DiscordRole> {
        return this.getREST().request<DiscordRole>(`/guilds/${guildId}/roles`, {
            method: "POST",
            body: {
                name: options.name,
                color: options.color,
                hoist: options.hoist,
                mentionable: options.mentionable,
                permissions: options.permissions?.toString(),
            },
        });
    }

    async deleteRole(guildId: string, roleId: string): Promise<void> {
        await this.getREST().request(`/guilds/${guildId}/roles/${roleId}`, {
            method: "DELETE",
        });
    }

    // 工具方法

    getREST(): DiscordREST {
        return this.client.getREST();
    }

    getClient(): DiscordLite {
        return this.client;
    }
}
