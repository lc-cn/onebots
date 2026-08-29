import type { GroupInviteEvent, GroupRequestEvent } from "@icqqjs/icqq/lib/events";
import { Adapter } from "onebots";
import { resolveICQQMediaSource } from "./messages.js";
import { ICQQSocialActions } from "./social-actions.js";

/** 群成员、管理、申请和群消息扩展动作。 */
export abstract class ICQQGroupActions extends ICQQSocialActions {
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
        const groupId = this.numericId(params.group_id.string, "group_id");
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
        if (params.is_dismiss) {
            throw new TypeError("ICQQ 不支持通过退出群动作解散群聊");
        }
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = this.numericId(params.group_id.string, "group_id");
        await bot.leaveGroup(groupId);
    }

    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupName(
            this.numericId(params.group_id.string, "group_id"),
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
        const groupId = this.numericId(params.group_id.string, "group_id");
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
        const groupId = this.numericId(params.group_id.string, "group_id");
        const userId = this.numericId(params.user_id.string, "user_id");
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
        const groupId = this.numericId(params.group_id.string, "group_id");
        const userId = this.numericId(params.user_id.string, "user_id");
        await bot.kickGroupMember(groupId, userId, params.reject_add_request);
    }

    /** 邀请好友加入指定群。 */
    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const accepted = await account.client.inviteFriendToGroup(
            this.numericId(params.group_id.string, "group_id"),
            this.numericId(params.user_id.string, "user_id"),
        );
        if (!accepted) {
            throw new Error(
                `邀请好友 ${params.user_id.string} 加入群 ${params.group_id.string} 失败`,
            );
        }
    }

    async muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupBan(
            this.numericId(params.group_id.string, "group_id"),
            this.numericId(params.user_id.string, "user_id"),
            params.duration,
        );
        this.assertNativeAccepted(accepted, "设置群成员禁言");
    }

    async muteGroupAll(uin: string, params: Adapter.MuteGroupAllParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupWholeBan(
            this.numericId(params.group_id.string, "group_id"),
            params.enable,
        );
        this.assertNativeAccepted(accepted, "设置全员禁言");
    }

    async muteGroupAnonymous(uin: string, params: Adapter.MuteGroupAnonymousParams): Promise<void> {
        await this.requireNativeClient(uin).setGroupAnonymousBan(
            this.numericId(params.group_id.string, "group_id"),
            params.flag,
            params.duration,
        );
    }

    async setGroupAnonymous(uin: string, params: Adapter.SetGroupAnonymousParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupAnonymous(
            this.numericId(params.group_id.string, "group_id"),
            params.enable,
        );
        this.assertNativeAccepted(accepted, "设置群匿名");
    }

    async setGroupAdmin(uin: string, params: Adapter.SetGroupAdminParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupAdmin(
            this.numericId(params.group_id.string, "group_id"),
            this.numericId(params.user_id.string, "user_id"),
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
        const groupId = this.numericId(params.group_id.string, "group_id");
        const userId = this.numericId(params.user_id.string, "user_id");
        await bot.setGroupCard(groupId, userId, params.card);
    }

    async setGroupSpecialTitle(
        uin: string,
        params: Adapter.SetGroupSpecialTitleParams,
    ): Promise<void> {
        const accepted = await this.requireNativeClient(uin).setGroupSpecialTitle(
            this.numericId(params.group_id.string, "group_id"),
            this.numericId(params.user_id.string, "user_id"),
            params.special_title,
            params.duration,
        );
        this.assertNativeAccepted(accepted, "设置群专属头衔");
    }

    async sendGroupNudge(uin: string, params: Adapter.SendGroupNudgeParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).sendGroupPoke(
            this.numericId(params.group_id.string, "group_id"),
            this.numericId(params.user_id.string, "user_id"),
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
            this.numericId(params.group_id.string, "group_id"),
            resolveICQQMediaSource({ file: params.file }, "group_avatar"),
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
        if (message.group_id !== this.numericId(params.group_id.string, "group_id")) {
            throw new TypeError("消息不属于指定群");
        }
        await client.pickGroup(message.group_id).setReaction(message.seq, String(params.face_id));
    }

    async sendGroupAnnouncement(
        uin: string,
        params: Adapter.SendGroupAnnouncementParams,
    ): Promise<void> {
        const accepted = await this.requireNativeClient(uin)
            .pickGroup(this.numericId(params.group_id.string, "group_id"))
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
}
