import { Adapter, CommonTypes } from "onebots";
import type { DiscordMessage, DiscordMember } from "./bot.js";
import { ChannelType } from "./types.js";
import { DiscordMessageActions } from "./message-actions.js";

/** Discord Guild 与成员动作，以及共用消息投影。 */
export abstract class DiscordGuildActions extends DiscordMessageActions {
    // ============================================
    // 群组（服务器/Guild）相关方法
    // ============================================

    /**
     * 获取群列表（服务器列表）
     */
    async getGroupList(
        uin: string,
        _params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guilds = bot.getGuilds();

        return [...guilds.values()].map(guild => ({
            group_id: this.createId(guild.id),
            group_name: guild.name,
            member_count: guild.approximate_member_count ?? 0,
        }));
    }

    /**
     * 获取群信息（服务器信息）
     */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;

        const guild = await bot.getGuild(guildId);

        return {
            group_id: this.createId(guild.id),
            group_name: guild.name,
            member_count: guild.approximate_member_count ?? 0,
        };
    }

    /**
     * 退出群组（服务器）
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;

        // 使用 REST API 离开服务器
        await bot.getREST().request(`/users/@me/guilds/${guildId}`, {
            method: "DELETE",
        });
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;

        const members = await bot.getGuildMembers(guildId);

        return [...members.values()].map(member => ({
            group_id: params.group_id,
            user_id: this.createId(member.user.id),
            user_name: member.user.username,
            card: member.nick || undefined,
            role: this.getMemberRole(member),
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;
        const userId = params.user_id.string;

        const member = await bot.getGuildMember(guildId, userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(member.user.id),
            user_name: member.user.username,
            card: member.nick || undefined,
            role: this.getMemberRole(member),
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;
        const userId = params.user_id.string;

        await bot.kickMember(guildId, userId, "Kicked via onebots");
    }

    /**
     * 群成员禁言（超时）
     */
    async muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;
        const userId = params.user_id.string;
        const duration = params.duration;

        if (duration === 0) {
            // 解除禁言
            await bot.removeTimeout(guildId, userId);
        } else {
            // 设置超时
            await bot.timeoutMember(guildId, userId, duration);
        }
    }

    /**
     * 设置群名片（昵称）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = this.coerceId(params.group_id as CommonTypes.Id | string | number).string;
        const userId = this.coerceId(params.user_id as CommonTypes.Id | string | number).string;

        await bot.setMemberNickname(guildId, userId, params.card || null);
    }

    /**
     * 发送群消息表情回应
     */
    async sendGroupMessageReaction(
        uin: string,
        params: Adapter.SendGroupMessageReactionParams,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = this.coerceId(params.group_id as CommonTypes.Id | string | number).string;
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;

        // Discord 使用 Unicode emoji 或自定义 emoji 格式
        const emoji = String.fromCodePoint(params.face_id);

        await bot.addReaction(channelId, messageId, emoji);
    }

    // 辅助方法
    // ============================================

    /**
     * 转换消息为 MessageInfo
     */
    protected convertMessageToInfo(message: DiscordMessage): Adapter.MessageInfo {
        const segments: CommonTypes.Segment[] = [];

        if (message.content) {
            segments.push({
                type: "text",
                data: { text: message.content },
            });
        }

        for (const attachment of message.attachments || []) {
            const type = attachment.content_type?.startsWith("image/")
                ? "image"
                : attachment.content_type?.startsWith("audio/")
                  ? "audio"
                  : attachment.content_type?.startsWith("video/")
                    ? "video"
                    : "file";
            segments.push({
                type,
                data: {
                    file: attachment.id,
                    url: attachment.url,
                    filename: attachment.filename,
                    content_type: attachment.content_type,
                },
            });
        }

        // 确定场景类型
        let sceneType: CommonTypes.Scene;
        if (message.channel.type === ChannelType.DM) {
            sceneType = "private";
        } else {
            sceneType = "channel";
        }

        return {
            message_id: this.createId(message.id),
            time: Math.floor(message.createdTimestamp / 1000),
            sender: {
                scene_type: sceneType,
                sender_id: this.createId(message.author.id),
                scene_id: this.createId(message.channel.id),
                sender_name: message.author.username,
                scene_name: "DM",
            },
            message: segments,
        };
    }

    /**
     * 获取成员角色
     */
    protected getMemberRole(member: DiscordMember): "owner" | "admin" | "member" {
        // 轻量版简化处理：根据角色数量判断
        if (member.roles && member.roles.length > 2) {
            return "admin";
        }
        return "member";
    }
}
