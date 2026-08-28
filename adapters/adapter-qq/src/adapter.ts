/**
 * QQ 官方机器人适配器
 *
 * v4 重大变更：不再自带 bot 实现，直接依赖 `qq-official-bot` SDK。
 * SDK Bot 实例直接作为 Account.client 暴露给上层；adapter 只负责：
 *   1. 把用户配置转换为 SDK BotConfig
 *   2. 监听 SDK 事件并翻译为 CommonEvent.Message / CommonEvent.Notice
 *   3. 把 OneBot/Satori 协议层的 sendMessage/deleteMessage 等调用路由到 SDK
 */
import {
    Bot,
    ReceiverMode,
    segment,
    type Sendable,
    type MessageElem,
    type GuildMessageEvent,
    type GroupMessageEvent,
    type PrivateMessageEvent,
    type MessageAuditEvent,
    type GuildChangeNoticeEvent,
    type ChannelChangeNoticeEvent,
    type GuildMemberChangeNoticeEvent,
    type MessageReactionNoticeEvent,
    type GuildActionNoticeEvent,
    type GroupActionNoticeEvent,
    type GroupJoinRequestNoticeEvent,
    type FriendChangeNoticeEvent,
    type FriendReceiveNoticeEvent,
    type GroupChangeNoticeEvent,
    type GroupReceiveNoticeEvent,
    type GroupMemberChangeNoticeEvent,
    type ForumNoticeEvent,
    type ThreadChangeNoticeEvent,
    type PostChangeNoticeEvent,
    type ReplyChangeNoticeEvent,
    type FormAuditNoticeEvent,
    type FriendActionNoticeEvent,
} from "qq-official-bot";
import { Account, AdapterRegistry, AccountStatus, dateLikeToEventMs } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { CommonEvent, type CommonTypes } from "onebots";
import type { QQConfig } from "./types.js";
import { mapIntents } from "./intents.js";

const DEFAULT_API_BASE_URL = "https://api.bot.qq.com";
const SANDBOX_API_BASE_URL = "https://sandbox.api.sgroup.qq.com";

export class QQAdapter extends Adapter<Bot, "qq"> {
    constructor(app: BaseApp) {
        super(app, "qq");
        this.icon = "https://q.qq.com/favicon.ico";
    }

    // ============================================
    // 消息发送 / 撤回 / 查询
    // ============================================

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number).string;
        const sendable = this.buildSendable(params.message);

        let res: { id?: string } | undefined;
        switch (params.scene_type) {
            case "group":
                res = await bot.group(sceneId).send(sendable);
                break;
            case "private":
                res = await bot.user(sceneId).send(sendable);
                break;
            case "channel":
                res = await bot.channel(sceneId).send(sendable);
                break;
            case "direct":
                res = await bot.direct(sceneId).send(sendable);
                break;
            default:
                throw new Error(`不支持的消息场景类型: ${params.scene_type}`);
        }

        return {
            message_id: this.createId(res?.id ?? Date.now().toString()),
        };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const sceneType = params.scene_type;
        const sceneId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : undefined;

        if (!sceneId || !sceneType) {
            throw new Error("删除消息需要提供 scene_type 和 scene_id");
        }

        switch (sceneType) {
            case "channel":
                await bot.channel(sceneId).recall(messageId);
                break;
            case "direct":
                await bot.direct(sceneId).recall(messageId);
                break;
            case "group":
                await bot.group(sceneId).recall(messageId);
                break;
            case "private":
                await bot.user(sceneId).recall(messageId);
                break;
            default:
                throw new Error(`QQ官方API暂不支持撤回 ${sceneType} 类型的消息`);
        }
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const sceneType = params.scene_type;
        const sceneId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : undefined;

        if (sceneType === "channel" && sceneId) {
            const msg = await bot.channel(sceneId).getMessage(messageId);
            return {
                message_id: this.createId((msg as any).message_id ?? messageId),
                time: Date.now(),
                sender: {
                    scene_type: "channel",
                    sender_id: this.createId((msg as any).sender?.user_id ?? ""),
                    scene_id: this.createId(sceneId),
                    sender_name: (msg as any).sender?.user_name ?? "",
                    scene_name: "",
                },
                message: this.parseSdkMessage((msg as any).message ?? []),
            };
        }

        if (sceneType === "direct" && sceneId) {
            const msg = await bot.direct(sceneId).getMessage(messageId);
            return {
                message_id: this.createId((msg as any).message_id ?? messageId),
                time: Date.now(),
                sender: {
                    scene_type: "direct",
                    sender_id: this.createId((msg as any).sender?.user_id ?? ""),
                    scene_id: this.createId(sceneId),
                    sender_name: (msg as any).sender?.user_name ?? "",
                    scene_name: "",
                },
                message: this.parseSdkMessage((msg as any).message ?? []),
            };
        }

        throw new Error(`getMessage 需要提供 scene_type (channel/direct) 和 scene_id`);
    }

    // ============================================
    // 用户 / 频道查询
    // ============================================

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const info = await account.client.getSelfInfo();
        return {
            user_id: this.createId(info.id),
            user_name: info.username,
            avatar: info.avatar,
        };
    }

    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const guilds = await account.client.getGuildList();
        return guilds.map(g => ({
            guild_id: this.createId(g.guild_id),
            guild_name: g.guild_name,
            guild_display_name: g.guild_name,
        }));
    }

    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const g = await account.client.guild(params.guild_id.string).info();
        return {
            guild_id: this.createId(g.guild_id),
            guild_name: g.guild_name,
            guild_display_name: g.guild_name,
        };
    }

    async getChannelList(
        uin: string,
        params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        if (!params?.guild_id) throw new Error("获取子频道列表需要提供 guild_id");
        const list = await account.client.getChannelList(params.guild_id.string);
        return list.map(c => ({
            channel_id: this.createId(c.channel_id),
            channel_name: c.channel_name,
            channel_type: c.channel_type,
        }));
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const c = await account.client.getChannelInfo(params.channel_id.string);
        return {
            channel_id: this.createId(c.channel_id),
            channel_name: c.channel_name,
            channel_type: c.channel_type,
        };
    }

    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const ch = await account.client.createChannel(params.guild_id.string, {
            name: params.channel_name,
            type: params.channel_type ?? 0,
            parent_id: params.parent_id?.string,
        } as any);
        return {
            channel_id: this.createId(ch.id),
            channel_name: ch.name,
            channel_type: ch.type as number,
            parent_id: ch.parent_id ? this.createId(ch.parent_id) : undefined,
        };
    }

    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.updateChannel(params.channel_id.string, {
            name: params.channel_name,
            parent_id: params.parent_id?.string,
        } as any);
    }

    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.deleteChannel(params.channel_id.string);
    }

    // ============================================
    // 频道成员管理
    // ============================================

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const m = await account.client.getGuildMemberInfo(
            params.guild_id.string,
            params.user_id.string,
        );
        return {
            guild_id: params.guild_id,
            user_id: this.createId(m.member_id),
            user_name: m.username,
            nickname: m.card,
            role: m.roles?.[0],
        };
    }

    async getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const guildId = (params as any).guild_id?.string ?? params.channel_id.string;
        const members = await account.client.getGuildMemberList(guildId);
        return members.map(m => ({
            channel_id: params.channel_id,
            user_id: this.createId(m.member_id),
            user_name: m.username,
            role: m.roles?.includes("4")
                ? ("owner" as const)
                : m.roles?.includes("2")
                  ? ("admin" as const)
                  : ("member" as const),
        }));
    }

    async kickChannelMember(uin: string, _params: Adapter.KickChannelMemberParams): Promise<void> {
        void this.getAccount(uin);
        throw new Error("踢出频道成员需要提供 guild_id，请使用 kickGuildMember 方法");
    }

    async setChannelMemberMute(
        uin: string,
        _params: Adapter.SetChannelMemberMuteParams,
    ): Promise<void> {
        void this.getAccount(uin);
        throw new Error("设置频道成员禁言需要提供 guild_id，请使用 muteGuildMember 方法");
    }

    // ============================================
    // 频道扩展方法（需要 guild_id）
    // ============================================

    async kickGuildMember(
        uin: string,
        guildId: string,
        userId: string,
        addBlacklist?: boolean,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.kickGuildMember(guildId, userId, undefined, addBlacklist);
    }

    async muteGuildMember(
        uin: string,
        guildId: string,
        userId: string,
        duration: number,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.muteGuildMember(guildId, userId, duration);
    }

    async unmuteGuildMember(uin: string, guildId: string, userId: string): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.unMuteGuildMember(guildId, userId);
    }

    async muteGuild(uin: string, guildId: string, duration: number): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.muteGuild(guildId, duration);
    }

    async unmuteGuild(uin: string, guildId: string): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.unMuteGuild(guildId);
    }

    // ============================================
    // 频道角色管理（旧版有，新版补齐）
    // ============================================

    async getGuildRoles(uin: string, guildId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getGuildRoles(guildId);
    }

    async createGuildRole(
        uin: string,
        guildId: string,
        role: { name?: string; color: number; hoist: 0 | 1 },
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.creatGuildRole(guildId, role);
    }

    async updateGuildRole(
        uin: string,
        guildId: string,
        roleId: string,
        updateInfo: { name?: string; color?: string; hoist?: boolean },
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.updateGuildRole(guildId, roleId, updateInfo as any);
    }

    async deleteGuildRole(uin: string, guildId: string, roleId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.deleteGuildRole(guildId, roleId);
    }

    async addGuildMemberRole(
        uin: string,
        guildId: string,
        channelId: string,
        memberId: string,
        roleId: string,
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.addGuildMemberRoles(guildId, channelId, memberId, roleId);
    }

    async removeGuildMemberRole(
        uin: string,
        guildId: string,
        channelId: string,
        memberId: string,
        roleId: string,
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.removeGuildMemberRoles(guildId, channelId, memberId, roleId);
    }

    // ============================================
    // 频道公告（旧版有，新版补齐）
    // ============================================

    async setChannelAnnounce(uin: string, guildId: string, channelId: string, messageId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.setChannelAnnounce(guildId, channelId, messageId);
    }

    // ============================================
    // 精华消息 / 置顶（旧版有，新版补齐）
    // ============================================

    async getChannelPins(uin: string, channelId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getChannelPins(channelId);
    }

    async pinChannelMessage(uin: string, channelId: string, messageId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.pinChannelMessage(channelId, messageId);
    }

    async unpinChannelMessage(uin: string, channelId: string, messageId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.unPinChannelMessage(channelId, messageId);
    }

    // ============================================
    // 表态（旧版有，新版补齐）
    // ============================================

    async addReaction(
        uin: string,
        channelId: string,
        messageId: string,
        type: number,
        emojiId: string,
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.addGuildMessageReaction(
            channelId,
            messageId,
            type as any,
            emojiId as `${number}`,
        );
    }

    async removeReaction(
        uin: string,
        channelId: string,
        messageId: string,
        type: number,
        emojiId: string,
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.deleteGuildMessageReaction(
            channelId,
            messageId,
            type as any,
            emojiId as `${number}`,
        );
    }

    async getReactionMembers(
        uin: string,
        channelId: string,
        messageId: string,
        type: number,
        emojiId: string,
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getGuildMessageReactionMembers(
            channelId,
            messageId,
            type as any,
            emojiId as `${number}`,
        );
    }

    // ============================================
    // 日程管理（旧版有，新版补齐）
    // ============================================

    async getSchedules(uin: string, channelId: string, since?: number) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getChannelSchedules(channelId, since);
    }

    async getSchedule(uin: string, channelId: string, scheduleId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getChannelScheduleInfo(channelId, scheduleId);
    }

    async createSchedule(uin: string, channelId: string, schedule: any) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.createChannelSchedule(channelId, schedule);
    }

    async updateSchedule(uin: string, channelId: string, scheduleId: string, schedule: any) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.updateChannelSchedule(channelId, scheduleId, schedule);
    }

    async deleteSchedule(uin: string, channelId: string, scheduleId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.deleteChannelSchedule(channelId, scheduleId);
    }

    // ============================================
    // 富媒体上传（旧版有，新版补齐 + 增强）
    // ============================================

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number).string;
        const targetType = params.scene_type === "group" ? ("group" as const) : ("user" as const);
        const fileData = params.url ?? params.path ?? params.data ?? "";

        const result = await bot.uploadMedia(sceneId, targetType, fileData);
        return {
            file_id: this.createId(result.file_uuid ?? result.id ?? Date.now().toString()),
            file_name: params.name,
            url: result.raw_url,
        };
    }

    // ============================================
    // 私信会话创建（旧版有，新版补齐）
    // ============================================

    async createUserChannel(
        uin: string,
        params: Adapter.CreateUserChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const userId = params.user_id.string;
        const guildId = params.guild_id?.string;
        if (!guildId) throw new Error("创建私信会话需要提供 guild_id");

        const dms = await account.client.createDirectSession(guildId, userId);
        return {
            channel_id: this.createId(dms.channel_id),
            channel_name: "DMS",
            channel_type: 0,
        };
    }

    // ============================================
    // 群管理（SDK 新增能力）
    // ============================================

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const groupId = params.group_id.string;
        const info = await account.client.getGroupInfo(groupId);
        return {
            group_id: this.createId(info.group_openid),
            group_name: info.group_name,
            member_count: info.group_member_num,
        };
    }

    async handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const groupId = (params as any).group_id?.string;
        const memberOpenid = (params as any).user_id?.string ?? params.flag;
        if (!groupId || !memberOpenid) throw new Error("处理加群请求需要 group_id 和 user_id/flag");

        await account.client.approveGroupJoinRequest(groupId, memberOpenid, {
            op: params.approve ? "approve" : "decline",
            join_request_id: params.flag ?? params.request_id?.string,
            reject_reason: params.reason,
        });
    }

    // ============================================
    // 帖子 / 论坛（SDK 新增能力）
    // ============================================

    async getChannelThreads(uin: string, channelId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getChannelThreads(channelId);
    }

    async getChannelThread(uin: string, channelId: string, threadId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getChannelThreadInfo(channelId, threadId);
    }

    async publishThread(
        uin: string,
        channelId: string,
        title: string,
        content: string,
        format?: 1 | 2 | 3 | 4,
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.publishThread(channelId, title, content, format);
    }

    async deleteThread(uin: string, channelId: string, threadId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.deleteThread(channelId, threadId);
    }

    // ============================================
    // 音频控制（SDK 新增能力）
    // ============================================

    async controlChannelAudio(uin: string, channelId: string, audioControl: any) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.controlChannelAudio(channelId, audioControl);
    }

    // ============================================
    // 权限管理（SDK 新增能力）
    // ============================================

    async getChannelPermissionOfRole(uin: string, channelId: string, roleId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getChannelPermissionOfRole(channelId, roleId);
    }

    async updateChannelPermissionOfRole(
        uin: string,
        channelId: string,
        roleId: string,
        permission: { add?: string; remove?: string },
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.updateChannelPermissionOfRole(channelId, roleId, permission);
    }

    async getChannelMemberPermission(uin: string, channelId: string, memberId: string) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.getChannelMemberPermission(channelId, memberId);
    }

    async updateChannelMemberPermission(
        uin: string,
        channelId: string,
        memberId: string,
        permission: { add?: string; remove?: string },
    ) {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client.updateChannelMemberPermission(channelId, memberId, permission);
    }

    // ============================================
    // 系统
    // ============================================

    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots-adapter-qq",
            app_version: "4.0.0",
            impl: "onebots",
            version: "4.0.0",
            onebot_version: "12",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    // ============================================
    // 账号创建（核心）
    // ============================================

    createAccount(config: Account.Config<"qq">): Account<"qq", Bot> {
        const qqConfig: QQConfig = {
            account_id: config.account_id,
            appid: config.appid,
            secret: config.secret,
            sandbox: config.sandbox,
            intents: config.intents,
            mode: config.mode ?? "websocket",
            apiBaseUrl: config.apiBaseUrl,
            port: config.port,
            path: config.path,
        };

        if (qqConfig.mode === "webhook" && !qqConfig.port) {
            throw new Error(`[QQ] ${config.account_id} webhook 模式必须配置 port`);
        }

        const sdkIntents = mapIntents(qqConfig.intents, m => this.logger.warn(m));
        const apiBaseUrl =
            qqConfig.apiBaseUrl ?? (qqConfig.sandbox ? SANDBOX_API_BASE_URL : DEFAULT_API_BASE_URL);

        const sdkConfig: any = {
            appid: qqConfig.appid,
            secret: qqConfig.secret,
            mode: qqConfig.mode === "webhook" ? ReceiverMode.WEBHOOK : ReceiverMode.WEBSOCKET,
            intents: sdkIntents,
            removeAt: true,
            apiBaseUrl,
        };
        if (qqConfig.mode === "webhook") {
            sdkConfig.port = qqConfig.port;
            sdkConfig.path = qqConfig.path ?? "/";
        }

        const bot = new Bot(sdkConfig);
        const account = new Account<"qq", Bot>(this, bot, config);

        // ---- 生命周期 ----
        bot.on("ready", async () => {
            const modeText = qqConfig.mode === "webhook" ? "(Webhook模式)" : "(WebSocket模式)";
            this.logger.info(`[QQ] ${config.account_id} 已连接 ${modeText}`);
            account.status = AccountStatus.Online;

            try {
                const selfInfo = await bot.getSelfInfo();
                account.nickname = selfInfo.username || "QQ机器人";
                account.avatar = selfInfo.avatar || this.icon;
            } catch {
                account.nickname = "QQ机器人";
                account.avatar = this.icon;
            }
        });
        bot.on("error", (err: Error) => {
            this.logger.error(`[QQ] ${config.account_id} 错误:`, err);
        });
        bot.on("close", () => {
            if (account.status !== AccountStatus.OffLine) {
                this.logger.warn(`[QQ] ${config.account_id} 连接关闭`);
                account.status = AccountStatus.OffLine;
            }
        });

        // ---- 事件异常保护 ----
        const safe = (fn: () => void) => {
            try {
                fn();
            } catch (e) {
                this.logger.error(`[QQ] ${config.account_id} 事件处理异常:`, e);
            }
        };

        // ---- 消息事件 ----
        bot.on("message.guild", (e: GuildMessageEvent) =>
            safe(() => this.handleGuildMessage(account, e, config.account_id)),
        );
        bot.on("message.private.direct", (e: PrivateMessageEvent) =>
            safe(() => this.handleDirectMessage(account, e, config.account_id)),
        );
        bot.on("message.group", (e: GroupMessageEvent) =>
            safe(() => this.handleGroupMessage(account, e, config.account_id)),
        );
        // 使用 message.private.friend 而非 message.private，避免与 message.private.direct 重复分发
        bot.on("message.private.friend", (e: PrivateMessageEvent) =>
            safe(() => this.handleC2CMessage(account, e, config.account_id)),
        );

        // ---- 消息审核事件 ----
        bot.on("message.audit.pass", (e: MessageAuditEvent) =>
            safe(() => this.handleAuditEvent(account, true, e, config.account_id)),
        );
        bot.on("message.audit.reject", (e: MessageAuditEvent) =>
            safe(() => this.handleAuditEvent(account, false, e, config.account_id)),
        );

        // ---- 频道 / 子频道 / 成员通知 ----
        bot.on("notice.guild.increase", (e: GuildChangeNoticeEvent) =>
            safe(() => this.handleGuildEvent(account, "create", e, config.account_id)),
        );
        bot.on("notice.guild.update", (e: GuildChangeNoticeEvent) =>
            safe(() => this.handleGuildEvent(account, "update", e, config.account_id)),
        );
        bot.on("notice.guild.decrease", (e: GuildChangeNoticeEvent) =>
            safe(() => this.handleGuildEvent(account, "delete", e, config.account_id)),
        );
        bot.on("notice.channel.increase", (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, "create", e, config.account_id)),
        );
        bot.on("notice.channel.update", (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, "update", e, config.account_id)),
        );
        bot.on("notice.channel.decrease", (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, "delete", e, config.account_id)),
        );
        bot.on("notice.channel.enter", (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, "enter", e, config.account_id)),
        );
        bot.on("notice.channel.exit", (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, "exit", e, config.account_id)),
        );
        bot.on("notice.guild.member.increase", (e: GuildMemberChangeNoticeEvent) =>
            safe(() => this.handleGuildMemberEvent(account, "add", e, config.account_id)),
        );
        bot.on("notice.guild.member.update", (e: GuildMemberChangeNoticeEvent) =>
            safe(() => this.handleGuildMemberEvent(account, "update", e, config.account_id)),
        );
        bot.on("notice.guild.member.decrease", (e: GuildMemberChangeNoticeEvent) =>
            safe(() => this.handleGuildMemberEvent(account, "remove", e, config.account_id)),
        );

        // ---- 表态事件 ----
        bot.on("notice.reaction.add", (e: MessageReactionNoticeEvent) =>
            safe(() => this.handleReactionEvent(account, "add", e, config.account_id)),
        );
        bot.on("notice.reaction.remove", (e: MessageReactionNoticeEvent) =>
            safe(() => this.handleReactionEvent(account, "remove", e, config.account_id)),
        );

        // ---- 互动 / 按钮回调 ----
        bot.on("notice.guild.action", (e: GuildActionNoticeEvent) =>
            safe(() => this.handleInteractionEvent(account, e, config.account_id)),
        );
        bot.on("notice.group.action", (e: GroupActionNoticeEvent) =>
            safe(() => this.handleGroupActionEvent(account, e, config.account_id)),
        );
        bot.on("notice.friend.action", (e: FriendActionNoticeEvent) =>
            safe(() => this.handleFriendActionEvent(account, e, config.account_id)),
        );

        // ---- 好友变更事件 ----
        bot.on("notice.friend.increase", (e: FriendChangeNoticeEvent) =>
            safe(() => this.handleFriendChangeEvent(account, "increase", e, config.account_id)),
        );
        bot.on("notice.friend.decrease", (e: FriendChangeNoticeEvent) =>
            safe(() => this.handleFriendChangeEvent(account, "decrease", e, config.account_id)),
        );
        bot.on("notice.friend.receive_open", (e: FriendReceiveNoticeEvent) =>
            safe(() => this.handleFriendReceiveEvent(account, "open", e, config.account_id)),
        );
        bot.on("notice.friend.receive_close", (e: FriendReceiveNoticeEvent) =>
            safe(() => this.handleFriendReceiveEvent(account, "close", e, config.account_id)),
        );

        // ---- 群机器人加入/移除事件 ----
        bot.on("notice.group.increase", (e: GroupChangeNoticeEvent) =>
            safe(() => this.handleGroupBotEvent(account, "increase", e, config.account_id)),
        );
        bot.on("notice.group.decrease", (e: GroupChangeNoticeEvent) =>
            safe(() => this.handleGroupBotEvent(account, "decrease", e, config.account_id)),
        );
        bot.on("notice.group.receive_open", (e: GroupReceiveNoticeEvent) =>
            safe(() => this.handleGroupReceiveEvent(account, "open", e, config.account_id)),
        );
        bot.on("notice.group.receive_close", (e: GroupReceiveNoticeEvent) =>
            safe(() => this.handleGroupReceiveEvent(account, "close", e, config.account_id)),
        );

        // ---- 群成员变更事件 ----
        bot.on("notice.group.member.increase", (e: GroupMemberChangeNoticeEvent) =>
            safe(() =>
                this.handleGroupMemberChangeEvent(account, "increase", e, config.account_id),
            ),
        );
        bot.on("notice.group.member.decrease", (e: GroupMemberChangeNoticeEvent) =>
            safe(() =>
                this.handleGroupMemberChangeEvent(account, "decrease", e, config.account_id),
            ),
        );

        // ---- 加群请求 ----
        bot.on("notice.group.join_request", (e: GroupJoinRequestNoticeEvent) =>
            safe(() => this.handleGroupJoinRequestEvent(account, e, config.account_id)),
        );

        // ---- 论坛事件 ----
        bot.on("notice.forum", (e: ForumNoticeEvent) =>
            safe(() => this.handleForumEvent(account, e, config.account_id)),
        );

        // ---- 账号生命周期 ----
        account.on("start", async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`[QQ] ${config.account_id} 启动失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });
        account.on("stop", async () => {
            try {
                await bot.stop();
            } catch (error) {
                this.logger.error(`[QQ] ${config.account_id} 停止失败:`, error);
            }
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    // ============================================
    // 事件翻译 — 消息
    // ============================================

    private handleGuildMessage(
        account: Account<"qq", Bot>,
        e: GuildMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === "string" ? e.raw_message : "";
        const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
        this.logger.info(
            `[QQ] 频道消息 | 消息ID: ${e.message_id} | 频道: ${e.channel_id} | ` +
                `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "message",
            message_type: "channel",
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            group: e.guild_id ? { id: this.createId(e.guild_id), name: e.guild_name } : undefined,
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    private handleDirectMessage(
        account: Account<"qq", Bot>,
        e: PrivateMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === "string" ? e.raw_message : "";
        const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
        this.logger.info(
            `[QQ] 频道私信 | 消息ID: ${e.message_id} | ` +
                `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "message",
            message_type: "direct",
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            group: e.guild_id ? { id: this.createId(e.guild_id), name: "" } : undefined,
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    private handleGroupMessage(
        account: Account<"qq", Bot>,
        e: GroupMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === "string" ? e.raw_message : "";
        const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
        this.logger.info(
            `[QQ] 群消息 | 消息ID: ${e.message_id} | 群: ${e.group_id} | ` +
                `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "message",
            message_type: "group",
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            group: { id: this.createId(e.group_id), name: e.group_name },
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    private handleC2CMessage(
        account: Account<"qq", Bot>,
        e: PrivateMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === "string" ? e.raw_message : "";
        const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
        this.logger.info(
            `[QQ] 私聊消息 | 消息ID: ${e.message_id} | ` +
                `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "message",
            message_type: "private",
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    // ============================================
    // 事件翻译 — 消息审核
    // ============================================

    private handleAuditEvent(
        account: Account<"qq", Bot>,
        passed: boolean,
        e: MessageAuditEvent,
        accountId: string,
    ): void {
        this.logger.info(
            `[QQ] 消息审核${passed ? "通过" : "拒绝"} | audit_id: ${e.audit_id} | 频道: ${e.channel_id}`,
        );
        account.dispatch({
            id: this.createId(e.audit_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs(e.audit_time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: passed ? "message_audit_pass" : "message_audit_reject",
            audit_id: e.audit_id,
            guild_id: e.guild_id,
            channel_id: e.channel_id,
            message_id: e.message_id ? this.createId(e.message_id) : undefined,
            raw_event: e,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 频道 / 子频道 / 成员
    // ============================================

    private handleGuildEvent(
        account: Account<"qq", Bot>,
        action: "create" | "update" | "delete",
        e: GuildChangeNoticeEvent,
        accountId: string,
    ): void {
        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: `guild_${action}`,
            group: e.guild_id ? { id: this.createId(e.guild_id), name: e.guild_name } : undefined,
            operator: e.operator_id ? { id: this.createId(e.operator_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    private handleChannelEvent(
        account: Account<"qq", Bot>,
        action: "create" | "update" | "delete" | "enter" | "exit",
        e: ChannelChangeNoticeEvent,
        accountId: string,
    ): void {
        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: `channel_${action}`,
            group: e.guild_id ? { id: this.createId(e.guild_id), name: "" } : undefined,
            channel_id: e.channel_id,
            channel_name: e.channel_name,
            operator: e.operator_id ? { id: this.createId(e.operator_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    private handleGuildMemberEvent(
        account: Account<"qq", Bot>,
        action: "add" | "update" | "remove",
        e: GuildMemberChangeNoticeEvent,
        accountId: string,
    ): void {
        const noticeType: CommonEvent.NoticeType =
            action === "add" ? "group_increase" : action === "remove" ? "group_decrease" : "custom";

        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: noticeType,
            sub_type: action,
            user: { id: this.createId(e.user_id), name: e.user_name },
            group: { id: this.createId(e.guild_id), name: "" },
            operator: e.operator_id ? { id: this.createId(e.operator_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 表态
    // ============================================

    private handleReactionEvent(
        account: Account<"qq", Bot>,
        action: "add" | "remove",
        e: MessageReactionNoticeEvent,
        accountId: string,
    ): void {
        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: action === "add" ? "reaction_added" : "reaction_removed",
            user: { id: this.createId(e.user_id), name: "" },
            group: { id: this.createId(e.guild_id), name: "" },
            channel_id: e.channel_id,
            message_id: this.createId(e.message_id),
            emoji_id: e.emoji?.id,
            emoji_type: e.emoji?.type,
            raw_event: e,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 互动（按钮回调）
    // ============================================

    private handleInteractionEvent(
        account: Account<"qq", Bot>,
        e: GuildActionNoticeEvent,
        accountId: string,
    ): void {
        const resolved = (e as any).data?.resolved as
            | { button_id?: string; button_data?: string }
            | undefined;
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: "interaction",
            interaction_type: (e as any).type,
            chat_type: (e as any).chat_type,
            button_id: resolved?.button_id,
            button_data: resolved?.button_data,
            user: (e as any).user_openid
                ? { id: this.createId((e as any).user_openid), name: "" }
                : undefined,
            group: e.guild_id ? { id: this.createId(e.guild_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    private handleGroupActionEvent(
        account: Account<"qq", Bot>,
        e: GroupActionNoticeEvent,
        accountId: string,
    ): void {
        const resolved = (e as any).data?.resolved as
            | { button_id?: string; button_data?: string }
            | undefined;
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: "group_action",
            interaction_type: (e as any).type,
            button_id: resolved?.button_id,
            button_data: resolved?.button_data,
            user: (e as any).user_openid
                ? { id: this.createId((e as any).user_openid), name: "" }
                : undefined,
            group: e.group_id ? { id: this.createId(e.group_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    private handleFriendActionEvent(
        account: Account<"qq", Bot>,
        e: FriendActionNoticeEvent,
        accountId: string,
    ): void {
        const resolved = (e as any).data?.resolved as
            | { button_id?: string; button_data?: string }
            | undefined;
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: "friend_action",
            interaction_type: (e as any).type,
            button_id: resolved?.button_id,
            button_data: resolved?.button_data,
            user: e.operator_id ? { id: this.createId(e.operator_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 好友变更
    // ============================================

    private handleFriendChangeEvent(
        account: Account<"qq", Bot>,
        action: "increase" | "decrease",
        e: FriendChangeNoticeEvent,
        accountId: string,
    ): void {
        this.logger.info(
            `[QQ] 好友${action === "increase" ? "新增" : "减少"} | user: ${e.user_id}`,
        );
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs(e.time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: `friend_${action}`,
            user: { id: this.createId(e.user_id), name: "" },
        } as CommonEvent.Notice);
    }

    private handleFriendReceiveEvent(
        account: Account<"qq", Bot>,
        action: "open" | "close",
        e: FriendReceiveNoticeEvent,
        accountId: string,
    ): void {
        this.logger.info(
            `[QQ] 好友主动消息${action === "open" ? "开启" : "关闭"} | user: ${e.user_id}`,
        );
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs(e.time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: `friend_receive_${action}`,
            user: { id: this.createId(e.user_id), name: "" },
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 群机器人加入/移除、群消息接收设置
    // ============================================

    private handleGroupBotEvent(
        account: Account<"qq", Bot>,
        action: "increase" | "decrease",
        e: GroupChangeNoticeEvent,
        accountId: string,
    ): void {
        this.logger.info(
            `[QQ] 群机器人${action === "increase" ? "加入" : "移除"} | group: ${e.group_id}`,
        );
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs(e.time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: action === "increase" ? "group_increase" : "group_decrease",
            sub_type: `bot_${action}`,
            group: { id: this.createId(e.group_id), name: "" },
            operator: e.operator_id ? { id: this.createId(e.operator_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    private handleGroupReceiveEvent(
        account: Account<"qq", Bot>,
        action: "open" | "close",
        e: GroupReceiveNoticeEvent,
        accountId: string,
    ): void {
        this.logger.info(
            `[QQ] 群主动消息${action === "open" ? "开启" : "关闭"} | group: ${e.group_id}`,
        );
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs(e.time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: `group_receive_${action}`,
            group: { id: this.createId(e.group_id), name: "" },
            operator: e.operator_id ? { id: this.createId(e.operator_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 群成员变更
    // ============================================

    private handleGroupMemberChangeEvent(
        account: Account<"qq", Bot>,
        action: "increase" | "decrease",
        e: GroupMemberChangeNoticeEvent,
        accountId: string,
    ): void {
        this.logger.info(
            `[QQ] 群成员${action === "increase" ? "加入" : "退出"} | group: ${e.group_id} | user: ${e.user_id}`,
        );
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs(e.time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: action === "increase" ? "group_increase" : "group_decrease",
            sub_type: `member_${action}`,
            user: { id: this.createId(e.user_id), name: "" },
            group: { id: this.createId(e.group_id), name: "" },
            operator: e.operator_id ? { id: this.createId(e.operator_id), name: "" } : undefined,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 加群请求
    // ============================================

    private handleGroupJoinRequestEvent(
        account: Account<"qq", Bot>,
        e: GroupJoinRequestNoticeEvent,
        accountId: string,
    ): void {
        this.logger.info(
            `[QQ] 加群请求 | group: ${e.group_id} | user: ${e.user_id} (${e.username})`,
        );
        account.dispatch({
            id: this.createId((e as any).event_id ?? e.join_request_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e.apply_at as any) ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: "group_join_request",
            user: { id: this.createId(e.user_id), name: e.username },
            group: { id: this.createId(e.group_id), name: "" },
            request_id: e.join_request_id,
            apply_source: e.apply_source,
            invited_by: e.invited_by,
            flag: e.join_request_id,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 事件翻译 — 论坛
    // ============================================

    private handleForumEvent(
        account: Account<"qq", Bot>,
        e: ForumNoticeEvent,
        accountId: string,
    ): void {
        const subType = e.sub_type;
        const extra: Record<string, unknown> = {};

        if ("thread_id" in e) extra.thread_id = (e as ThreadChangeNoticeEvent).thread_id;
        if ("post_id" in e) extra.post_id = (e as PostChangeNoticeEvent).post_id;
        if ("reply_id" in e) extra.reply_id = (e as ReplyChangeNoticeEvent).reply_id;
        if ("title" in e) extra.title = (e as ThreadChangeNoticeEvent).title;
        if ("content" in e) extra.content = (e as ThreadChangeNoticeEvent).content;
        if ("result" in e) {
            extra.audit_result = (e as FormAuditNoticeEvent).result;
            extra.audit_message = (e as FormAuditNoticeEvent).message;
        }

        this.logger.info(
            `[QQ] 论坛事件 | sub_type: ${subType} | guild: ${e.guild_id} | channel: ${e.channel_id}`,
        );
        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: "qq",
            bot_id: this.createId(accountId),
            type: "notice",
            notice_type: "custom",
            sub_type: `forum_${subType}`,
            group: e.guild_id ? { id: this.createId(e.guild_id), name: "" } : undefined,
            channel_id: e.channel_id,
            author_id: e.author_id,
            ...extra,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 消息段转换
    // ============================================

    private buildSendable(message: CommonTypes.Segment[]): Sendable {
        const elems: MessageElem[] = [];
        for (const seg of message) {
            if (typeof seg === "string") {
                elems.push(segment.text(seg));
                continue;
            }
            switch (seg.type) {
                case "text":
                    elems.push(segment.text(String(seg.data.text ?? "")));
                    break;
                case "at":
                    if (seg.data.qq === "all") {
                        elems.push(segment.at("all"));
                    } else {
                        elems.push(segment.at(String(seg.data.qq ?? seg.data.id ?? "")));
                    }
                    break;
                case "face":
                    elems.push(segment.face(Number(seg.data.id), seg.data.text as any));
                    break;
                case "image": {
                    const src = String(seg.data.url ?? seg.data.file ?? "");
                    elems.push(segment.image(src, { url: src }));
                    break;
                }
                case "reply":
                    elems.push(segment.reply(String(seg.data.id ?? seg.data.message_id)));
                    break;
                case "video":
                    elems.push(segment.video(String(seg.data.url ?? seg.data.file)));
                    break;
                case "audio":
                    elems.push(segment.audio(String(seg.data.url ?? seg.data.file)));
                    break;
                case "markdown":
                    elems.push(segment.markdown(seg.data as any));
                    break;
                case "ark":
                    elems.push(segment.ark(Number(seg.data.template_id), seg.data.kv as any));
                    break;
                case "embed":
                    elems.push(
                        segment.embed(
                            String(seg.data.title ?? ""),
                            String(seg.data.prompt ?? ""),
                            seg.data.thumbnail as any,
                            seg.data.fields as any,
                        ),
                    );
                    break;
                case "keyboard":
                    elems.push(segment.keyboard(String(seg.data.id)));
                    break;
                case "link":
                    elems.push(segment.link(String(seg.data.channel_id ?? seg.data.id)));
                    break;
                default:
                    if (seg.data?.text) {
                        elems.push(segment.text(String(seg.data.text)));
                    } else if (seg.data?.url) {
                        elems.push(segment.image(String(seg.data.url)));
                    }
                    break;
            }
        }
        return elems.length === 1 ? elems[0] : elems;
    }

    private parseSdkMessage(sendable: Sendable): CommonTypes.Segment[] {
        const arr = Array.isArray(sendable) ? sendable : [sendable];
        const out: CommonTypes.Segment[] = [];
        for (const el of arr) {
            if (!el || typeof el !== "object") continue;
            switch (el.type) {
                case "text":
                    out.push({ type: "text", data: { text: (el as any).data.text } });
                    break;
                case "at":
                    out.push({
                        type: "at",
                        data: {
                            qq:
                                (el as any).data.user_id === "all"
                                    ? "all"
                                    : String((el as any).data.user_id ?? (el as any).data.id),
                        },
                    });
                    break;
                case "face":
                    out.push({
                        type: "face",
                        data: { id: String((el as any).data.id), text: (el as any).data.text },
                    });
                    break;
                case "image":
                    out.push({
                        type: "image",
                        data: {
                            url: (el as any).data.url,
                            file: (el as any).data.file,
                            name: (el as any).data.name,
                        },
                    });
                    break;
                case "reply":
                    out.push({
                        type: "reply",
                        data: { id: (el as any).data.id, message_id: (el as any).data.id },
                    });
                    break;
                case "video":
                    out.push({
                        type: "video",
                        data: {
                            url: (el as any).data.url,
                            file: (el as any).data.file,
                            name: (el as any).data.name,
                        },
                    });
                    break;
                case "audio":
                    out.push({
                        type: "audio",
                        data: {
                            url: (el as any).data.url,
                            file: (el as any).data.file,
                            name: (el as any).data.name,
                        },
                    });
                    break;
                case "markdown":
                    out.push({ type: "markdown", data: (el as any).data });
                    break;
                case "ark":
                    out.push({ type: "ark", data: (el as any).data });
                    break;
                case "embed":
                    out.push({ type: "embed", data: (el as any).data });
                    break;
                case "keyboard":
                    out.push({ type: "keyboard", data: (el as any).data });
                    break;
                case "link":
                    out.push({ type: "link", data: (el as any).data });
                    break;
                case "button":
                    out.push({ type: "button", data: (el as any).data });
                    break;
            }
        }
        return out;
    }
}

// 声明模块扩展
declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            qq: QQConfig;
        }
    }
}

// 注册适配器
AdapterRegistry.register("qq", QQAdapter, {
    name: "qq",
    displayName: "QQ官方机器人",
    description: "QQ官方机器人适配器（基于 qq-official-bot），支持频道、群聊和私聊",
    icon: "https://q.qq.com/favicon.ico",
    homepage: "https://bot.q.qq.com/wiki",
    author: "凉菜",
});
