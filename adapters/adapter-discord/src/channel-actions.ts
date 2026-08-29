import { Adapter } from "onebots";
import { type DiscordBot } from "./bot.js";
import { DiscordGuildActions } from "./guild-actions.js";
import { DISCORD_PLATFORM_ACTIONS, executeDiscordPlatformAction } from "./platform-actions.js";

/** Discord 频道、成员、媒体、系统和平台扩展动作。 */
export abstract class DiscordActionAdapter extends DiscordGuildActions {
    // ============================================
    // 频道相关方法
    // ============================================

    /**
     * 获取频道服务器信息
     */
    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.guild_id.string;

        const guild = await bot.getGuild(guildId);

        return {
            guild_id: this.createId(guild.id),
            guild_name: guild.name,
            guild_display_name: guild.name,
        };
    }

    /**
     * 获取频道服务器列表
     */
    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guilds = bot.getGuilds();

        return [...guilds.values()].map(guild => ({
            guild_id: this.createId(guild.id),
            guild_name: guild.name,
            guild_display_name: guild.name,
        }));
    }

    /**
     * 获取频道成员信息
     */
    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.guild_id.string;
        const userId = params.user_id.string;

        const member = await bot.getGuildMember(guildId, userId);

        return {
            guild_id: params.guild_id,
            user_id: this.createId(member.user.id),
            user_name: member.user.username,
            nickname: member.nick || undefined,
            role: this.getMemberRole(member),
        };
    }

    /**
     * 获取频道信息
     */
    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.channel_id.string;

        const channel = await bot.getChannel(channelId);

        if (!channel) {
            throw new Error(`频道 ${channelId} 不存在`);
        }

        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name || "",
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        };
    }

    /**
     * 获取频道列表
     */
    async getChannelList(
        uin: string,
        params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        if (!params?.guild_id) {
            throw new Error("获取频道列表需要提供 guild_id");
        }

        const bot = account.client;
        const guildId = params.guild_id.string;

        const channels = await bot.getGuildChannels(guildId);

        return [...channels.values()].map(channel => ({
            channel_id: this.createId(channel.id),
            channel_name: channel.name || "",
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        }));
    }

    /**
     * 创建频道
     */
    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.guild_id.string;

        const channel = await bot.createTextChannel(guildId, params.channel_name, {
            parent: params.parent_id?.string,
        });

        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name || "",
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        };
    }

    /**
     * 删除频道
     */
    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.channel_id.string;

        await bot.deleteChannel(channelId);
    }

    /**
     * 更新频道
     */
    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.channel_id.string;

        await bot.updateChannel(channelId, {
            name: params.channel_name,
            parent: params.parent_id?.string,
        });
    }

    // ============================================
    // 频道成员相关方法
    // ============================================

    /**
     * 获取频道成员信息
     */
    async getChannelMemberInfo(
        uin: string,
        params: Adapter.GetChannelMemberInfoParams,
    ): Promise<Adapter.ChannelMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.channel_id.string;
        const userId = params.user_id.string;

        // 获取频道所属的服务器
        const channel = await bot.getChannel(channelId);
        if (!channel || !channel.guild_id) {
            throw new Error(`频道 ${channelId} 不属于任何服务器`);
        }

        const member = await bot.getGuildMember(channel.guild_id, userId);

        return {
            channel_id: params.channel_id,
            user_id: this.createId(member.user.id),
            user_name: member.user.username,
            role: this.getMemberRole(member),
        };
    }

    /**
     * 获取频道成员列表
     */
    async getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.channel_id.string;

        // 获取频道所属的服务器
        const channel = await bot.getChannel(channelId);
        if (!channel || !channel.guild_id) {
            throw new Error(`频道 ${channelId} 不属于任何服务器`);
        }

        const members = await bot.getGuildMembers(channel.guild_id);

        return [...members.values()].map(member => ({
            channel_id: params.channel_id,
            user_id: this.createId(member.user.id),
            user_name: member.user.username,
            role: this.getMemberRole(member),
        }));
    }

    /**
     * 踢出频道成员
     */
    async kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.channel_id.string;
        const userId = params.user_id.string;

        // 获取频道所属的服务器
        const channel = await bot.getChannel(channelId);
        if (!channel || !channel.guild_id) {
            throw new Error(`频道 ${channelId} 不属于任何服务器`);
        }

        await bot.kickMember(channel.guild_id, userId);
    }

    /**
     * 设置频道成员禁言
     */
    async setChannelMemberMute(
        uin: string,
        params: Adapter.SetChannelMemberMuteParams,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.channel_id.string;
        const userId = params.user_id.string;

        // 获取频道所属的服务器
        const channel = await bot.getChannel(channelId);
        if (!channel || !channel.guild_id) {
            throw new Error(`频道 ${channelId} 不属于任何服务器`);
        }

        if (params.mute) {
            // Discord 超时最长 28 天
            await bot.timeoutMember(channel.guild_id, userId, 28 * 24 * 60 * 60);
        } else {
            await bot.removeTimeout(channel.guild_id, userId);
        }
    }

    // ============================================
    // 媒体资源相关方法
    // ============================================

    /**
     * 检查是否可以发送图片
     */
    async canSendImage(_uin: string): Promise<boolean> {
        return true; // Discord 支持图片发送
    }

    /**
     * 检查是否可以发送语音
     */
    async canSendRecord(_uin: string): Promise<boolean> {
        return true; // Discord 支持音频文件发送
    }

    async executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!DISCORD_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeDiscordPlatformAction(this.requireBot(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return DISCORD_PLATFORM_ACTIONS.has(action);
    }

    private requireBot(uin: string): DiscordBot {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client;
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots-discord",
            app_version: "1.0.0",
            impl: "discord-lite",
            version: "1.0.0",
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        if (!account) {
            return { good: false };
        }

        const bot = account.client;
        return {
            online: bot.isReady(),
            good: bot.isReady(),
        };
    }

    // ============================================
    // 账号创建
    // ============================================
}
