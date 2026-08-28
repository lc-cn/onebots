/**
 * ICQQ 适配器
 * 继承 Adapter 基类，实现 ICQQ 平台功能
 */
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { Account, AdapterRegistry, AccountStatus, unixSecondsToEventMs } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { ICQQBot, segment } from "./bot.js";
import { CommonEvent, CommonTypes } from "onebots";
import type { Client } from "@icqqjs/icqq";
import type {
    MessageElem,
    PrivateMessage,
    GroupMessage,
    ForwardMessage,
} from "@icqqjs/icqq/lib/message";
import type {
    FriendRequestEvent,
    GroupInviteEvent,
    GroupRequestEvent,
} from "@icqqjs/icqq/lib/events";
import type { GfsDirStat, GfsFileStat } from "@icqqjs/icqq/lib/gfs";
import { icqqCapabilities } from "./capabilities.js";
import type {
    ICQQOfflineEvent,
    ICQQQRCodeEvent,
    ICQQAuthEvent,
    ICQQSliderEvent,
    ICQQDeviceEvent,
    ICQQLoginErrorEvent,
} from "./types.js";

async function readPackageVersion(url: URL): Promise<string> {
    const metadata: unknown = JSON.parse(await readFile(url, "utf8"));
    if (
        typeof metadata !== "object" ||
        metadata === null ||
        !("version" in metadata) ||
        typeof metadata.version !== "string"
    ) {
        throw new TypeError(`包元数据缺少 version: ${url.pathname}`);
    }
    return metadata.version;
}
import type {
    ICQQConfig,
    ICQQUser,
    ICQQPrivateMessageEvent,
    ICQQGroupMessageEvent,
    ICQQFriendRequestEvent,
    ICQQGroupRequestEvent,
    ICQQGroupIncreaseEvent,
    ICQQGroupDecreaseEvent,
    ICQQMessageElement,
} from "./types.js";

export class ICQQAdapter extends Adapter<ICQQBot, "icqq"> {
    constructor(app: BaseApp) {
        super(app, "icqq", icqqCapabilities);
        this.icon = "https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        // 转换消息格式
        const icqqMessage = this.buildICQQMessage(message);

        let messageId: string;
        if (scene_type === "private") {
            const result = await bot.sendPrivateMessage(Number(sceneId.string), icqqMessage);
            messageId = result.message_id || result.seq?.toString() || "";
        } else if (scene_type === "group") {
            const result = await bot.sendGroupMessage(Number(sceneId.string), icqqMessage);
            messageId = result.message_id || result.seq?.toString() || "";
        } else if (scene_type === "channel") {
            const [guildId, channelId, ...rest] = sceneId.string.split(":");
            if (!guildId || !channelId || rest.length > 0) {
                throw new TypeError("ICQQ 频道 scene_id 必须为 {guild_id}:{channel_id}");
            }
            const result = await this.requireNativeClient(uin).sendGuildMsg(
                guildId,
                channelId,
                icqqMessage,
            );
            messageId = `${guildId}:${channelId}:${result.seq}:${result.rand}:${result.time}`;
        } else {
            throw new Error(`不支持的消息类型: ${scene_type}`);
        }

        return {
            message_id: this.createId(messageId),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.recallMessage(
            this.coerceId(params.message_id as CommonTypes.Id | string | number).string,
        );
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msg = await bot.getMessage(
            this.coerceId(params.message_id as CommonTypes.Id | string | number).string,
        );

        return this.convertNativeMessage(msg);
    }

    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        const client = this.requireNativeClient(uin);
        const sceneId = Number(params.scene_id.string);
        const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
        const messages =
            params.scene_type === "group"
                ? await client.pickGroup(sceneId).getChatHistory(params.offset, limit)
                : await client.pickUser(sceneId).getChatHistory(params.offset, limit);
        return messages.map(message => this.convertNativeMessage(message));
    }

    async getForwardMessage(
        uin: string,
        params: Adapter.GetForwardMessageParams,
    ): Promise<Adapter.MessageInfo[]> {
        const client = this.requireNativeClient(uin);
        const resourceId = params.resource_id ?? params.message_id?.string;
        if (!resourceId) throw new TypeError("获取合并转发消息需要 resource_id 或 message_id");
        const messages = await client.getForwardMsg(resourceId);
        return messages.map((message, index) =>
            this.convertNativeMessage(message, `${resourceId}:${index}`),
        );
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        const client = this.requireNativeClient(uin);
        if (params.message_id) {
            await client.reportReaded(params.message_id.string);
            return;
        }
        const sceneId = Number(params.scene_id.string);
        if (params.scene_type === "group") {
            await client.pickGroup(sceneId).markRead();
        } else {
            await client.pickUser(sceneId).markRead();
        }
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人自身信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const info = bot.getLoginInfo();

        if (!info) throw new Error("Bot not ready");

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
            user_displayname: info.nickname,
            avatar: info.avatar,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = parseInt(params.user_id.string);
        const info = await bot.getStrangerInfo(userId);

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
            user_displayname: info.nickname,
            avatar: info.avatar,
        };
    }

    // ============================================
    // 好友相关方法
    // ============================================

    /**
     * 获取好友列表
     */
    async getFriendList(
        uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const friends = await bot.getFriendList();

        return friends.map(friend => ({
            user_id: this.createId(friend.user_id.toString()),
            user_name: friend.nickname,
            remark: friend.remark,
        }));
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = parseInt(params.user_id.string);
        const info = await bot.getStrangerInfo(userId);

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
        };
    }

    /** 同意或拒绝好友申请；flag 必须来自原始申请事件。 */
    async handleFriendRequest(
        uin: string,
        params: Adapter.HandleFriendRequestParams,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        if (!params.flag) throw new TypeError("处理 ICQQ 好友申请需要原始 flag");

        const accepted = await account.client.handleFriendRequest(
            params.flag,
            params.approve,
            params.remark,
        );
        if (!accepted) {
            throw new Error(`${params.approve ? "同意" : "拒绝"}好友申请失败`);
        }
    }

    async deleteFriend(uin: string, params: Adapter.DeleteFriendParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).deleteFriend(
            Number(params.user_id.string),
        );
        this.assertNativeAccepted(accepted, "删除好友");
    }

    async sendFriendNudge(uin: string, params: Adapter.SendFriendNudgeParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin)
            .pickFriend(Number(params.user_id.string))
            .poke(params.is_self);
        this.assertNativeAccepted(accepted, "发送好友戳一戳");
    }

    async sendLike(uin: string, params: Adapter.SendLikeParams): Promise<void> {
        const times = params.times ?? params.count ?? 1;
        const accepted = await this.requireNativeClient(uin)
            .pickUser(Number(params.user_id.string))
            .thumbUp(times);
        this.assertNativeAccepted(accepted, "发送好友赞");
    }

    async getFriendRequests(
        uin: string,
        params?: Adapter.GetFriendRequestsParams,
    ): Promise<Adapter.FriendRequest[]> {
        const requests = (await this.requireNativeClient(uin).getSystemMsg()).filter(
            (event): event is FriendRequestEvent => event.request_type === "friend",
        );
        const selected = params?.limit === undefined ? requests : requests.slice(0, params.limit);
        return selected.map(event => ({
            request_id: this.createId(event.flag),
            user_id: this.createId(event.user_id),
            user_name: event.nickname,
            message: event.comment,
            time: event.time,
        }));
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表
     */
    async getGroupList(
        uin: string,
        _params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groups = await bot.getGroupList();

        return groups.map(group => ({
            group_id: this.createId(group.group_id.toString()),
            group_name: group.group_name,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
        }));
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const info = await bot.getGroupInfo(groupId);

        if (!info) throw new Error(`Group ${groupId} not found`);

        return {
            group_id: this.createId(info.group_id.toString()),
            group_name: info.group_name,
            member_count: info.member_count,
            max_member_count: info.max_member_count,
        };
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        await bot.leaveGroup(groupId);
    }

    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupName(
            Number(params.group_id.string),
            params.group_name,
        );
        this.assertNativeAccepted(accepted, "设置群名称");
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
        const groupId = parseInt(params.group_id.string);
        const members = await bot.getGroupMemberList(groupId);

        return members.map(member => ({
            group_id: params.group_id,
            user_id: this.createId(member.user_id.toString()),
            user_name: member.nickname,
            card: member.card || "",
            role: member.role || "member",
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
        const groupId = parseInt(params.group_id.string);
        const userId = parseInt(params.user_id.string);
        const member = await bot.getGroupMemberInfo(groupId, userId);

        if (!member) throw new Error(`Member ${userId} not found in group ${groupId}`);

        return {
            group_id: params.group_id,
            user_id: params.user_id,
            user_name: member.nickname,
            card: member.card || "",
            role: member.role || "member",
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const userId = parseInt(params.user_id.string);
        await bot.kickGroupMember(groupId, userId, params.reject_add_request);
    }

    /** 邀请好友加入指定群。 */
    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const accepted = await account.client.inviteFriendToGroup(
            Number(params.group_id.string),
            Number(params.user_id.string),
        );
        if (!accepted) {
            throw new Error(
                `邀请好友 ${params.user_id.string} 加入群 ${params.group_id.string} 失败`,
            );
        }
    }

    async muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupBan(
            Number(params.group_id.string),
            Number(params.user_id.string),
            params.duration,
        );
        this.assertNativeAccepted(accepted, "设置群成员禁言");
    }

    async muteGroupAll(uin: string, params: Adapter.MuteGroupAllParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupWholeBan(
            Number(params.group_id.string),
            params.enable,
        );
        this.assertNativeAccepted(accepted, "设置全员禁言");
    }

    async muteGroupAnonymous(uin: string, params: Adapter.MuteGroupAnonymousParams): Promise<void> {
        await this.requireNativeClient(uin).setGroupAnonymousBan(
            Number(params.group_id.string),
            params.flag,
            params.duration,
        );
    }

    async setGroupAnonymous(uin: string, params: Adapter.SetGroupAnonymousParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupAnonymous(
            Number(params.group_id.string),
            params.enable,
        );
        this.assertNativeAccepted(accepted, "设置群匿名");
    }

    async setGroupAdmin(uin: string, params: Adapter.SetGroupAdminParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupAdmin(
            Number(params.group_id.string),
            Number(params.user_id.string),
            params.enable,
        );
        this.assertNativeAccepted(accepted, "设置群管理员");
    }

    /**
     * 设置群名片
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const userId = parseInt(params.user_id.string);
        await bot.setGroupCard(groupId, userId, params.card);
    }

    async setGroupSpecialTitle(
        uin: string,
        params: Adapter.SetGroupSpecialTitleParams,
    ): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupSpecialTitle(
            Number(params.group_id.string),
            Number(params.user_id.string),
            params.special_title,
            params.duration,
        );
        this.assertNativeAccepted(accepted, "设置群专属头衔");
    }

    async sendGroupNudge(uin: string, params: Adapter.SendGroupNudgeParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).sendGroupPoke(
            Number(params.group_id.string),
            Number(params.user_id.string),
        );
        this.assertNativeAccepted(accepted, "发送群戳一戳");
    }

    async handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        const flag = params.flag ?? params.request_id?.string;
        if (!flag) throw new TypeError("处理 ICQQ 群申请需要 request_id 或原始 flag");
        const accepted = await this.requireNativeClient(uin).setGroupAddRequest(
            flag,
            params.approve,
            params.reason,
        );
        this.assertNativeAccepted(accepted, `${params.approve ? "同意" : "拒绝"}群申请`);
    }

    async getGroupNotifications(
        uin: string,
        params?: Adapter.GetGroupNotificationsParams,
    ): Promise<Adapter.GroupNotification[]> {
        const requests = (await this.requireNativeClient(uin).getSystemMsg()).filter(
            (event): event is GroupRequestEvent | GroupInviteEvent =>
                event.request_type === "group",
        );
        const selected = params?.limit === undefined ? requests : requests.slice(0, params.limit);
        return selected.map(event => ({
            notification_id: this.createId(event.flag),
            group_id: this.createId(event.group_id),
            user_id: this.createId(event.user_id),
            type: event.sub_type,
            time: event.time,
        }));
    }

    async setGroupAvatar(uin: string, params: Adapter.SetGroupAvatarParams): Promise<void> {
        await this.requireNativeClient(uin).setGroupPortrait(
            Number(params.group_id.string),
            this.processFileData(params.file),
        );
    }

    async sendGroupMessageReaction(
        uin: string,
        params: Adapter.SendGroupMessageReactionParams,
    ): Promise<void> {
        const client = this.requireNativeClient(uin);
        const message = await client.getMsg(params.message_id.string);
        if (!message || message.message_type !== "group") {
            throw new TypeError("群消息表态需要有效的群消息 ID");
        }
        if (message.group_id !== Number(params.group_id.string)) {
            throw new TypeError("消息不属于指定群");
        }
        await client.pickGroup(message.group_id).setReaction(message.seq, String(params.face_id));
    }

    async sendGroupAnnouncement(
        uin: string,
        params: Adapter.SendGroupAnnouncementParams,
    ): Promise<void> {
        const accepted = await this.requireNativeClient(uin)
            .pickGroup(Number(params.group_id.string))
            .announce(params.content);
        this.assertNativeAccepted(accepted, "发送群公告");
    }

    async setGroupEssenceMessage(
        uin: string,
        params: Adapter.SetGroupEssenceMessageParams,
    ): Promise<void> {
        await this.requireNativeClient(uin).setEssenceMessage(params.message_id.string);
    }

    async deleteGroupEssenceMessage(
        uin: string,
        params: Adapter.DeleteGroupEssenceMessageParams,
    ): Promise<void> {
        await this.requireNativeClient(uin).removeEssenceMessage(params.message_id.string);
    }

    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        return this.requireNativeClient(uin)
            .getGuildList()
            .map(guild => ({
                guild_id: this.createId(guild.guild_id),
                guild_name: guild.guild_name,
            }));
    }

    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const guild = this.requireNativeClient(uin).getGuildInfo(params.guild_id.string);
        if (!guild) throw new Error(`Guild ${params.guild_id.string} not found`);
        return {
            guild_id: this.createId(guild.guild_id),
            guild_name: guild.guild_name,
        };
    }

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const members = await this.requireNativeClient(uin)
            .pickGuild(params.guild_id.string)
            .getMemberList();
        const member = members.find(item => item.tiny_id === params.user_id.string);
        if (!member) throw new Error(`Guild member ${params.user_id.string} not found`);
        return {
            guild_id: params.guild_id,
            user_id: this.createId(member.tiny_id),
            user_name: member.nickname,
            nickname: member.card || member.nickname,
            role: String(member.role),
        };
    }

    async getGuildMemberList(
        uin: string,
        params: Adapter.GetGuildMemberListParams,
    ): Promise<Adapter.GuildMemberInfo[]> {
        const members = await this.requireNativeClient(uin)
            .pickGuild(params.guild_id.string)
            .getMemberList();
        return members.map(member => ({
            guild_id: params.guild_id,
            user_id: this.createId(member.tiny_id),
            user_name: member.nickname,
            nickname: member.card || member.nickname,
            role: String(member.role),
        }));
    }

    async getChannelList(
        uin: string,
        params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        if (!params) throw new TypeError("获取 ICQQ 子频道列表需要 guild_id");
        return this.requireNativeClient(uin)
            .getChannelList(params.guild_id.string)
            .map(channel => ({
                channel_id: this.createId(channel.channel_id),
                channel_name: channel.channel_name,
                channel_type: channel.channel_type,
            }));
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const client = this.requireNativeClient(uin);
        const guildIds = params.guild_id ? [params.guild_id.string] : [...client.guilds.keys()];
        for (const guildId of guildIds) {
            const channel = client.getChannelInfo(guildId, params.channel_id.string);
            if (channel) {
                return {
                    channel_id: this.createId(channel.channel_id),
                    channel_name: channel.channel_name,
                    channel_type: channel.channel_type,
                };
            }
        }
        throw new Error(`Channel ${params.channel_id.string} not found`);
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const client = this.requireNativeClient(uin);
        const source = this.resolveUploadSource(params);
        if (params.scene_type === "group") {
            const file = await client
                .acquireGfs(Number(params.scene_id.string))
                .upload(source, params.folder_id?.string, params.name);
            return this.convertFileInfo(file);
        }
        if (params.scene_type === "private" || params.scene_type === "direct") {
            const file = await client
                .pickFriend(Number(params.scene_id.string))
                .uploadFile(source, params.name);
            return {
                file_id: this.createId(file.fid ?? params.name),
                file_name: file.name ?? params.name,
                file_size: file.size,
                url: file.url,
            };
        }
        throw new TypeError(`ICQQ 不支持在 ${params.scene_type} 场景上传文件`);
    }

    async deleteFile(uin: string, params: Adapter.DeleteFileParams): Promise<void> {
        if (!params.scene_id) throw new TypeError("删除 ICQQ 文件需要 scene_id");
        const client = this.requireNativeClient(uin);
        if (params.scene_type === "group") {
            await client.acquireGfs(Number(params.scene_id.string)).rm(params.file_id.string);
            return;
        }
        if (params.scene_type === "private" || params.scene_type === "direct") {
            const accepted = await client
                .pickFriend(Number(params.scene_id.string))
                .recallFile(params.file_id.string);
            this.assertNativeAccepted(accepted, "撤回私聊文件");
            return;
        }
        throw new TypeError("删除 ICQQ 文件需要 private、direct 或 group 场景");
    }

    async getGroupFiles(
        uin: string,
        params: Adapter.GetGroupFilesParams,
    ): Promise<Adapter.GroupFilesResult> {
        const entries = await this.requireNativeClient(uin)
            .acquireGfs(Number(params.group_id.string))
            .dir(params.parent_folder_id?.string ?? "/");
        return {
            files: entries.filter(this.isGfsFile).map(file => this.convertFileInfo(file)),
            folders: entries.filter(this.isGfsDirectory).map(folder => ({
                folder_id: this.createId(folder.fid),
                folder_name: folder.name,
            })),
        };
    }

    async createGroupFolder(
        uin: string,
        params: Adapter.CreateGroupFolderParams,
    ): Promise<Adapter.FolderInfo> {
        if (params.parent_folder_id && params.parent_folder_id.string !== "/") {
            throw new TypeError("ICQQ 仅支持在群文件根目录创建文件夹");
        }
        const folder = await this.requireNativeClient(uin)
            .acquireGfs(Number(params.group_id.string))
            .mkdir(params.folder_name);
        return {
            folder_id: this.createId(folder.fid),
            folder_name: folder.name,
        };
    }

    async getFileDownloadUrl(
        uin: string,
        params: Adapter.GetFileDownloadUrlParams,
    ): Promise<string> {
        const client = this.requireNativeClient(uin);
        if (params.scene_type === "group") {
            const file = await client
                .acquireGfs(Number(params.scene_id.string))
                .download(params.file_id.string);
            return file.url;
        }
        if (params.scene_type === "private" || params.scene_type === "direct") {
            return client
                .pickUser(Number(params.scene_id.string))
                .getFileUrl(params.file_id.string);
        }
        throw new TypeError(`ICQQ 不支持获取 ${params.scene_type} 场景的文件地址`);
    }

    async moveGroupFile(uin: string, params: Adapter.MoveGroupFileParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(Number(params.group_id.string))
            .mv(params.file_id.string, params.parent_folder_id.string);
    }

    async renameGroupFile(uin: string, params: Adapter.RenameGroupFileParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(Number(params.group_id.string))
            .rename(params.file_id.string, params.new_name);
    }

    async renameGroupFolder(uin: string, params: Adapter.RenameGroupFolderParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(Number(params.group_id.string))
            .rename(params.folder_id.string, params.new_name);
    }

    async deleteGroupFolder(uin: string, params: Adapter.DeleteGroupFolderParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(Number(params.group_id.string))
            .rm(params.folder_id.string);
    }

    async canSendImage(uin: string): Promise<boolean> {
        this.requireNativeClient(uin);
        return true;
    }

    async canSendRecord(uin: string): Promise<boolean> {
        this.requireNativeClient(uin);
        return true;
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        const [adapterVersion, icqqVersion] = await Promise.all([
            readPackageVersion(new URL("../package.json", import.meta.url)),
            readPackageVersion(new URL("../package.json", import.meta.resolve("@icqqjs/icqq"))),
        ]);
        return {
            app_name: "onebots ICQQ Adapter",
            app_version: adapterVersion,
            impl: "icqq",
            version: icqqVersion,
            impl_version: icqqVersion,
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    async getCookies(uin: string, params?: Adapter.GetCookiesParams): Promise<string> {
        const client = this.requireNativeClient(uin);
        const domain = params?.domain as Parameters<Client["getCookies"]>[0];
        return client.getCookies(domain);
    }

    async getCsrfToken(uin: string): Promise<number> {
        return this.requireNativeClient(uin).getCsrfToken();
    }

    async getCredentials(
        uin: string,
        params?: Adapter.GetCredentialsParams,
    ): Promise<Adapter.CredentialsInfo> {
        return {
            cookies: await this.getCookies(uin, params),
            csrf_token: await this.getCsrfToken(uin),
        };
    }

    async cleanCache(uin: string): Promise<void> {
        this.requireNativeClient(uin).cleanCache();
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<"icqq">): Account<"icqq", ICQQBot> {
        const icqqConfig: ICQQConfig = {
            account_id: config.account_id,
            password: config.password,
            protocol: config.protocol,
        };

        const bot = new ICQQBot(icqqConfig);
        const account = new Account<"icqq", ICQQBot>(this, bot, config);

        // 监听 Bot 事件
        bot.on("ready", (user: ICQQUser) => {
            this.logger.info(`ICQQ Bot ${user.nickname} (${user.user_id}) 已就绪`);
            account.status = AccountStatus.Online;
            account.nickname = user.nickname;
            account.avatar = user.avatar;
            this.emit("verification:clear", {
                platform: "icqq",
                account_id: config.account_id,
            } as Adapter.VerificationClear);
        });

        bot.on("offline", (event: ICQQOfflineEvent) => {
            const message = event.message || "账号已离线";
            this.logger.warn(`ICQQ Bot 离线: ${message}`);
            account.status = AccountStatus.OffLine;
            this.emit("verification:request", {
                platform: "icqq",
                account_id: config.account_id,
                type: "offline",
                hint: message,
                options: {
                    blocks: [{ type: "text", content: message }],
                },
                actions: [{ id: "relogin", label: "重新登录", variant: "primary" }],
            } as unknown as Adapter.VerificationRequest);
        });

        // 网络闪断：icqq 会按 reconn_interval 自动重连，勿推「重新登录」打断恢复
        bot.on("offline_network", (event: ICQQOfflineEvent) => {
            const message = event.message || "网络连接中断";
            this.logger.warn(`ICQQ Bot 网络离线（将自动重连）: ${message}`);
            account.status = AccountStatus.Pending;
        });

        bot.on("heartbeat_error", (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`ICQQ SSO 心跳异常（已吞掉，继续运行）: ${message}`);
        });

        const clearStatusCards = () => {
            this.emit("verification:clear", {
                platform: "icqq",
                account_id: config.account_id,
                type: "offline",
            } as Adapter.VerificationClear);
            this.emit("verification:clear", {
                platform: "icqq",
                account_id: config.account_id,
                type: "login_error",
            } as Adapter.VerificationClear);
        };

        bot.on("qrcode", (event: ICQQQRCodeEvent) => {
            clearStatusCards();
            this.logger.info(`ICQQ 请扫描二维码登录`);
            this.emit("qrcode", { account_id: config.account_id, image: event.image });
            const imageBase64 =
                event.image instanceof Buffer ? event.image.toString("base64") : event.image;
            this.emit("verification:request", {
                platform: "icqq",
                account_id: config.account_id,
                type: "qrcode",
                hint: "请使用手机 QQ 扫描下方二维码，在手机上确认后点击「已完成，继续登录」",
                confirmable: true,
                confirmLabel: "已完成，继续登录",
                options: { blocks: [{ type: "image", base64: imageBase64, alt: "登录二维码" }] },
            } as unknown as Adapter.VerificationRequest);
        });

        bot.on("auth", (event: ICQQAuthEvent) => {
            clearStatusCards();
            this.logger.warn(`ICQQ 需要身份验证:`, event);
            const blocks: Adapter.VerificationBlock[] = [];
            if (typeof event?.url === "string" && event.url) {
                blocks.push({ type: "link", url: event.url, label: event.url });
            }
            blocks.push({
                type: "text",
                content: "请按提示完成身份验证，完成后点击下方「已完成，继续登录」",
            });
            this.emit("verification:request", {
                platform: "icqq",
                account_id: config.account_id,
                type: "auth",
                hint: "ICQQ 要求完成身份验证后才能继续登录",
                confirmable: true,
                confirmLabel: "已完成，继续登录",
                options: { blocks },
            } as unknown as Adapter.VerificationRequest);
        });

        bot.on("slider", (event: ICQQSliderEvent) => {
            clearStatusCards();
            this.logger.info(`ICQQ 需要滑块验证: ${event.url}`);
            this.emit("slider", { account_id: config.account_id, url: event.url });
            this.emit("verification:request", {
                platform: "icqq",
                account_id: config.account_id,
                type: "slider",
                hint: "请在浏览器中打开下方链接完成滑块验证；完成后从网络响应取出 ticket 与 randstr，用英文逗号拼接后填入并提交",
                options: {
                    blocks: [
                        { type: "link", url: event.url, label: "打开滑块验证页面" },
                        { type: "text", content: "格式示例：ticket值,randstr值" },
                        {
                            type: "input",
                            key: "ticket",
                            placeholder: "ticket,randstr（英文逗号拼接）",
                        },
                    ],
                },
            } as unknown as Adapter.VerificationRequest);
        });

        bot.on("device", (event: ICQQDeviceEvent) => {
            clearStatusCards();
            this.logger.info(`ICQQ 需要设备锁验证: ${event.url}`);
            this.emit("device", {
                account_id: config.account_id,
                url: event.url,
                phone: event.phone,
            });
            const blocks: Array<
                { type: "link"; url: string; label?: string } | { type: "text"; content: string }
            > = [{ type: "link", url: event.url, label: event.url }];
            if (event.phone) blocks.push({ type: "text", content: `手机号：${event.phone}` });
            this.emit("verification:request", {
                platform: "icqq",
                account_id: config.account_id,
                type: "device",
                hint: "请在浏览器中打开下方链接完成设备锁验证，完成后点击「已完成，继续登录」",
                confirmable: true,
                confirmLabel: "已完成，继续登录",
                options: { blocks },
            } as unknown as Adapter.VerificationRequest);
            if (event.phone) {
                this.emit("verification:request", {
                    platform: "icqq",
                    account_id: config.account_id,
                    type: "sms",
                    hint: "使用短信验证：请先点击「发送验证码」，收到后填入 6 位验证码并提交",
                    requestSmsAvailable: true,
                    options: {
                        blocks: [
                            {
                                type: "input",
                                key: "code",
                                placeholder: "6 位短信验证码",
                                maxLength: 6,
                            },
                        ],
                    },
                } as unknown as Adapter.VerificationRequest);
            }
        });

        bot.on("login_error", (event: ICQQLoginErrorEvent) => {
            this.emit("verification:clear", {
                platform: "icqq",
                account_id: config.account_id,
                type: "offline",
            } as Adapter.VerificationClear);
            const message = event.message || "登录失败";
            this.logger.error(`ICQQ 登录失败:`, event);
            account.status = AccountStatus.OffLine;
            this.emit("verification:request", {
                platform: "icqq",
                account_id: config.account_id,
                type: "login_error",
                hint: message,
                options: {
                    blocks: [
                        { type: "text", content: message },
                        ...(event.code != null
                            ? [{ type: "text" as const, content: `错误码：${event.code}` }]
                            : []),
                    ],
                },
                actions: [{ id: "relogin", label: "重新登录", variant: "primary" }],
                data: { code: event.code, message },
            } as unknown as Adapter.VerificationRequest);
        });

        // 监听私聊消息
        bot.on("private_message", (event: ICQQPrivateMessageEvent) => {
            // 打印消息接收日志
            const contentPreview =
                event.raw_message.length > 100
                    ? event.raw_message.substring(0, 100) + "..."
                    : event.raw_message;
            this.logger.info(
                `[ICQQ] 收到私聊消息 | 消息ID: ${event.message_id} | ` +
                    `发送者: ${event.sender.nickname} (${event.user_id}) | 内容: ${contentPreview}`,
            );

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.message_id),
                timestamp: unixSecondsToEventMs(event.time),
                platform: "icqq",
                bot_id: this.createId(config.account_id),
                type: "message",
                message_type: "private",
                sender: {
                    id: this.createId(event.user_id.toString()),
                    name: event.sender.nickname,
                    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${event.user_id}&s=640`,
                },
                message_id: this.createId(event.message_id),
                raw_message: event.raw_message,
                message: this.convertICQQMessageToSegments(event.message),
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听群消息
        bot.on("group_message", (event: ICQQGroupMessageEvent) => {
            // 打印消息接收日志
            const contentPreview =
                event.raw_message.length > 100
                    ? event.raw_message.substring(0, 100) + "..."
                    : event.raw_message;
            this.logger.info(
                `[ICQQ] 收到群消息 | 消息ID: ${event.message_id} | 群: ${event.group.group_name} (${event.group_id}) | ` +
                    `发送者: ${event.sender.nickname} (${event.user_id}) | 内容: ${contentPreview}`,
            );

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.message_id),
                timestamp: unixSecondsToEventMs(event.time),
                platform: "icqq",
                bot_id: this.createId(config.account_id),
                type: "message",
                message_type: "group",
                sender: {
                    id: this.createId(event.user_id.toString()),
                    name: event.sender.nickname,
                    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${event.user_id}&s=640`,
                },
                group: {
                    id: this.createId(event.group_id.toString()),
                    name: event.group.group_name,
                },
                message_id: this.createId(event.message_id),
                raw_message: event.raw_message,
                message: this.convertICQQMessageToSegments(event.message),
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 好友申请的 opaque flag 必须原样保留，后续同意/拒绝动作依赖它。
        bot.on("friend_request", (event: ICQQFriendRequestEvent) => {
            const requestEvent: CommonEvent.Request<ICQQFriendRequestEvent> = {
                id: this.createId(event.request_id),
                timestamp: unixSecondsToEventMs(event.time),
                platform: "icqq",
                bot_id: this.createId(config.account_id),
                type: "request",
                request_type: "friend",
                user: {
                    id: this.createId(event.user_id.toString()),
                    name: event.nickname,
                },
                comment: event.comment,
                flag: event.request_id,
                raw_event: event,
            };
            account.dispatch(requestEvent);
        });

        // request_id 是 ICQQ 的 opaque flag；统一 ID 映射让各协议可安全往返该值。
        bot.on("group_request", (event: ICQQGroupRequestEvent) => {
            const requestEvent: CommonEvent.Request<ICQQGroupRequestEvent> = {
                id: this.createId(event.request_id),
                timestamp: unixSecondsToEventMs(event.time),
                platform: "icqq",
                bot_id: this.createId(config.account_id),
                type: "request",
                request_type: "group",
                sub_type: event.sub_type,
                user: {
                    id: this.createId(event.user_id.toString()),
                    name: event.nickname,
                },
                group: {
                    id: this.createId(event.group_id.toString()),
                },
                comment: event.comment,
                flag: event.request_id,
                raw_event: event,
            };
            account.dispatch(requestEvent);
        });

        // 监听群成员增加
        bot.on("group_increase", (event: ICQQGroupIncreaseEvent) => {
            const noticeEvent: CommonEvent.Notice = {
                id: this.createId(`${event.group_id}_${event.user_id}_${event.time}`),
                timestamp: unixSecondsToEventMs(event.time),
                platform: "icqq",
                bot_id: this.createId(config.account_id),
                type: "notice",
                notice_type: "group_increase",
                sub_type: event.operator_id === event.user_id ? "approve" : "invite",
                group: {
                    id: this.createId(event.group_id.toString()),
                },
                user: {
                    id: this.createId(event.user_id.toString()),
                },
                operator: event.operator_id
                    ? {
                          id: this.createId(event.operator_id.toString()),
                      }
                    : undefined,
            };
            account.dispatch(noticeEvent);
        });

        // 监听群成员减少
        bot.on("group_decrease", (event: ICQQGroupDecreaseEvent) => {
            const noticeEvent: CommonEvent.Notice = {
                id: this.createId(`${event.group_id}_${event.user_id}_${event.time}`),
                timestamp: unixSecondsToEventMs(event.time),
                platform: "icqq",
                bot_id: this.createId(config.account_id),
                type: "notice",
                notice_type: "group_decrease",
                sub_type: event.sub_type,
                group: {
                    id: this.createId(event.group_id.toString()),
                },
                user: {
                    id: this.createId(event.user_id.toString()),
                },
                operator: event.operator_id
                    ? {
                          id: this.createId(event.operator_id.toString()),
                      }
                    : undefined,
            };
            account.dispatch(noticeEvent);
        });

        // 启动时初始化 Bot
        account.on("start", async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`启动 ICQQ Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    /**
     * Web 验证提交：将前端提交的滑块 ticket 或短信验证码转交给 ICQQ Bot
     * 支持 data.ticket / data.code（兼容）或通用 data.value；data.action=relogin 触发重新登录
     */
    override async submitVerification(
        accountId: string,
        type: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        const account = this.getAccount(accountId);
        if (!account) {
            this.logger.warn(`submitVerification: 账号不存在 ${accountId}`);
            return;
        }
        const bot = account.client;
        const value = typeof data.value === "string" ? data.value : undefined;
        const action = typeof data.action === "string" ? data.action : undefined;

        if (action === "relogin" || type === "login_error" || type === "offline") {
            await this.setOnline(accountId);
            return;
        }

        if (type === "slider") {
            const ticket = (data.ticket ?? value) as string | undefined;
            if (typeof ticket === "string") bot.submitSlider(ticket);
        } else if (type === "sms") {
            const code = (data.code ?? value) as string | undefined;
            if (typeof code === "string") bot.submitSmsCode(code);
        } else if (type === "qrcode" || type === "auth" || type === "device") {
            // 扫码确认 / 身份验证 / 设备锁网页验证完成后需显式调用 login() 继续
            bot.continueLogin();
        } else {
            this.logger.debug(`submitVerification: 忽略类型 ${type} 或缺少参数`);
        }
    }

    /** 请求向密保手机发送短信验证码（设备锁时用户选短信验证前调用） */
    override requestSmsCode(accountId: string): Promise<void> {
        const account = this.getAccount(accountId);
        if (!account) {
            this.logger.warn(`requestSmsCode: 账号不存在 ${accountId}`);
            return Promise.resolve();
        }
        return account.client.sendSmsCode();
    }

    /** 重新登录：停止后再次 start，触发二维码/滑块等验证流程 */
    override async setOnline(uin: string): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) {
            throw new Error(`未找到账号 ${uin}`);
        }
        this.emit("verification:clear", {
            platform: "icqq",
            account_id: uin,
        } as Adapter.VerificationClear);
        account.status = AccountStatus.Pending;
        try {
            await account.client.stop();
        } catch (error) {
            this.logger.warn(`ICQQ 停止账号 ${uin} 时出错（将继续尝试登录）:`, error);
        }
        try {
            await account.client.start();
        } catch (error) {
            this.logger.error(`ICQQ 重新登录失败 ${uin}:`, error);
            account.status = AccountStatus.OffLine;
            throw error;
        }
    }

    override async setOffline(uin: string): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) {
            throw new Error(`未找到账号 ${uin}`);
        }
        await account.client.stop();
        account.status = AccountStatus.OffLine;
        this.emit("verification:clear", {
            platform: "icqq",
            account_id: uin,
        } as Adapter.VerificationClear);
    }

    // ============================================
    // 消息转换
    // ============================================

    /**
     * 处理 base64:// 前缀的文件数据
     * 如果是 base64 格式，转换为 Buffer；否则返回原始数据
     */
    private processFileData(file: string): string | Buffer {
        if (typeof file === "string" && file.startsWith("base64://")) {
            const base64Data = file.replace(/^base64:\/\//, "");

            // Strip whitespace (RFC 4648 allows whitespace in base64)
            const cleanedData = base64Data.replace(/\s/g, "");

            // Validate base64 format (basic validation)
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanedData)) {
                this.logger.warn(`Invalid base64 data format (length: ${cleanedData.length})`);
                return file; // Return original if invalid
            }

            try {
                return Buffer.from(cleanedData, "base64");
            } catch (error) {
                this.logger.error(`Failed to convert base64 to Buffer:`, error);
                return file; // Return original on error
            }
        }
        return file;
    }

    /** ICQQ 原生客户端只在适配器实现内部可见，不越过通用 Adapter seam。 */
    private requireNativeClient(uin: string): Client {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const client = account.client.getClient();
        if (!client) throw new Error(`Account ${uin} is not connected`);
        return client;
    }

    private assertNativeAccepted(accepted: boolean, operation: string): void {
        if (!accepted) throw new Error(`${operation}失败`);
    }

    private convertNativeMessage(
        message: PrivateMessage | GroupMessage | ForwardMessage,
        fallbackMessageId?: string,
    ): Adapter.MessageInfo {
        const isGroup = message.message_type === "group" && message.group_id !== undefined;
        const messageId = "message_id" in message ? message.message_id : fallbackMessageId;
        if (!messageId) throw new TypeError("ICQQ 消息缺少可用的 message_id");
        const senderName = "sender" in message ? message.sender?.nickname : message.nickname;
        return {
            message_id: this.createId(messageId),
            time: message.time,
            sender: {
                scene_type: isGroup ? "group" : "private",
                sender_id: this.createId(message.user_id),
                scene_id: this.createId(isGroup ? message.group_id : message.user_id),
                sender_name: senderName ?? "",
                scene_name: isGroup && "group_name" in message ? message.group_name : "",
            },
            message: this.convertICQQMessageToSegments(message.message),
        };
    }

    private resolveUploadSource(params: Adapter.UploadFileParams): string | Buffer {
        if (params.data) return Buffer.from(params.data, "base64");
        if (params.path) return params.path;
        if (params.url) {
            throw new TypeError(
                "ICQQ 文件上传不直接接受 URL，请先下载为本地路径或传入 base64 data",
            );
        }
        throw new TypeError("上传文件需要 path 或 base64 data");
    }

    private convertFileInfo(file: GfsFileStat): Adapter.FileInfo {
        return {
            file_id: this.createId(file.fid),
            file_name: file.name,
            file_size: file.size,
        };
    }

    private isGfsFile(entry: GfsFileStat | GfsDirStat): entry is GfsFileStat {
        return !entry.is_dir;
    }

    private isGfsDirectory(entry: GfsFileStat | GfsDirStat): entry is GfsDirStat {
        return entry.is_dir;
    }

    /**
     * 构建 ICQQ 消息
     */
    private buildICQQMessage(message: CommonTypes.Segment[]): Array<string | MessageElem> {
        const result: Array<string | MessageElem> = [];

        for (const seg of message) {
            if (typeof seg === "string") {
                result.push(seg);
            } else if (seg.type === "text") {
                result.push(seg.data.text || "");
            } else if (seg.type === "at") {
                const qq = seg.data.qq || seg.data.id || seg.data.user_id;
                if (qq === "all") {
                    result.push(segment.at("all"));
                } else {
                    result.push(segment.at(parseInt(qq as string)));
                }
            } else if (seg.type === "image") {
                const file = seg.data.url || seg.data.file;
                if (file) {
                    result.push(segment.image(this.processFileData(file)));
                }
            } else if (seg.type === "face") {
                const id = seg.data.id;
                if (id !== undefined) {
                    result.push(segment.face(parseInt(id as string)));
                }
            } else if (seg.type === "record" || seg.type === "audio") {
                const file = seg.data.url || seg.data.file;
                if (file) {
                    result.push(segment.record(this.processFileData(file)));
                }
            } else if (seg.type === "video") {
                const file = seg.data.url || seg.data.file;
                if (file) {
                    result.push(segment.video(this.processFileData(file)));
                }
            } else if (seg.type === "reply") {
                const id = seg.data.id;
                if (id) {
                    result.push({ type: "reply", id } as MessageElem);
                }
            } else if (seg.type === "share") {
                result.push(
                    segment.share(
                        seg.data.url || "",
                        seg.data.title || "",
                        seg.data.content,
                        seg.data.image,
                    ),
                );
            } else if (seg.type === "json") {
                result.push(segment.json(seg.data.data || ""));
            } else if (seg.type === "xml") {
                result.push(segment.xml(seg.data.data || ""));
            }
        }

        return result;
    }

    /**
     * 转换 ICQQ 消息到 Segment
     */
    private convertICQQMessageToSegments(
        message: ReadonlyArray<ICQQMessageElement | MessageElem>,
    ): CommonTypes.Segment[] {
        const result: CommonTypes.Segment[] = [];

        for (const elem of message) {
            switch (elem.type) {
                case "text":
                    result.push({ type: "text", data: { text: elem.text } });
                    break;
                case "face":
                    result.push({ type: "face", data: { id: elem.id.toString() } });
                    break;
                case "image":
                    result.push({
                        type: "image",
                        data: { url: elem.url || elem.file, file: elem.file },
                    });
                    break;
                case "record":
                    result.push({
                        type: "record",
                        data: { url: elem.url || elem.file, file: elem.file },
                    });
                    break;
                case "video":
                    result.push({
                        type: "video",
                        data: {
                            url: ("url" in elem ? elem.url : undefined) || elem.file,
                            file: elem.file,
                        },
                    });
                    break;
                case "at":
                    result.push({ type: "at", data: { qq: elem.qq.toString() } });
                    break;
                case "share":
                    result.push({
                        type: "share",
                        data: {
                            url: elem.url,
                            title: elem.title,
                            content: elem.content,
                            image: elem.image,
                        },
                    });
                    break;
                case "json":
                    result.push({ type: "json", data: { data: elem.data } });
                    break;
                case "xml":
                    result.push({ type: "xml", data: { data: elem.data } });
                    break;
                case "reply":
                    result.push({ type: "reply", data: { id: elem.id } });
                    break;
                default:
                    result.push({
                        type: "text",
                        data: { text: `[${(elem as ICQQMessageElement).type}]` },
                    });
            }
        }

        return result;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            icqq: ICQQConfig;
        }
    }
}

AdapterRegistry.register("icqq", ICQQAdapter, {
    name: "icqq",
    displayName: "ICQQ 机器人",
    description: "基于 ICQQ 协议的 QQ 机器人适配器，支持扫码登录和密码登录",
    icon: "https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png",
    homepage: "https://github.com/icqqjs/icqq",
    author: "凉菜",
    capabilities: icqqCapabilities,
});
