import type { GroupInviteEvent, GroupRequestEvent } from "@icqqjs/icqq/lib/events";
import { Adapter } from "onebots";
import { resolveICQQMediaSource } from "./messages.js";
import { ICQQSocialActions } from "./social-actions.js";
import { icqqOperationRejected, icqqResourceNotFound, invalidICQQParam } from "./errors.js";

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
        params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const bot = this.requireBot(uin);
        const groups = await bot.getGroupList(params?.no_cache);

        return groups.map(group => ({
            group_id: this.createId(group.group_id.toString()),
            group_name: group.group_name,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
            created_time: group.created_time,
        }));
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const bot = this.requireBot(uin);
        const groupId = this.numericId(params.group_id.string, "group_id");
        const info = await bot.getGroupInfo(groupId, params.no_cache);

        if (!info) throw icqqResourceNotFound("群", groupId);

        return {
            group_id: this.createId(info.group_id.toString()),
            group_name: info.group_name,
            member_count: info.member_count,
            max_member_count: info.max_member_count,
            created_time: info.created_time,
        };
    }

    /**
     * 退出群组；ICQQ 会在当前账号为群主时解散该群。
     *
     * `is_dismiss` 表达调用方意图，但 SDK 使用同一个原生动作处理退群与解散，
     * 最终权限和身份校验由 QQ 服务端完成。
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const bot = this.requireBot(uin);
        const groupId = this.numericId(params.group_id.string, "group_id");
        this.assertNativeAccepted(
            await bot.leaveGroup(groupId),
            params.is_dismiss ? "解散群聊" : "退出群聊",
        );
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
        const bot = this.requireBot(uin);
        const groupId = this.numericId(params.group_id.string, "group_id");
        const members = await bot.getGroupMemberList(groupId, params.no_cache);

        return members.map(member => ({
            group_id: params.group_id,
            user_id: this.createId(member.user_id.toString()),
            user_name: member.nickname,
            card: member.card || "",
            sex: member.sex ?? "unknown",
            age: member.age,
            area: member.area,
            level: member.level,
            role: member.role || "member",
            join_time: member.join_time,
            last_sent_time: member.last_sent_time,
            title: member.title ?? "",
            title_expire_time: member.title_expire_time,
            shut_up_end_time: member.shut_up_end_time,
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const bot = this.requireBot(uin);
        const groupId = this.numericId(params.group_id.string, "group_id");
        const userId = this.numericId(params.user_id.string, "user_id");
        const member = await bot.getGroupMemberInfo(groupId, userId, params.no_cache);

        if (!member) throw icqqResourceNotFound("群成员", { group_id: groupId, user_id: userId });

        return {
            group_id: params.group_id,
            user_id: params.user_id,
            user_name: member.nickname,
            card: member.card || "",
            sex: member.sex ?? "unknown",
            age: member.age,
            area: member.area,
            level: member.level,
            role: member.role || "member",
            join_time: member.join_time,
            last_sent_time: member.last_sent_time,
            title: member.title ?? "",
            title_expire_time: member.title_expire_time,
            shut_up_end_time: member.shut_up_end_time,
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const bot = this.requireBot(uin);
        const groupId = this.numericId(params.group_id.string, "group_id");
        const userId = this.numericId(params.user_id.string, "user_id");
        await bot.kickGroupMember(groupId, userId, params.reject_add_request);
    }

    /** 邀请好友加入指定群。 */
    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        const accepted = await this.requireBot(uin).inviteFriendToGroup(
            this.numericId(params.group_id.string, "group_id"),
            this.numericId(params.user_id.string, "user_id"),
        );
        if (!accepted) {
            throw icqqOperationRejected("邀请好友加入群", {
                group_id: params.group_id.string,
                user_id: params.user_id.string,
            });
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
        const bot = this.requireBot(uin);
        const groupId = this.numericId(params.group_id.string, "group_id");
        const userId = this.numericId(params.user_id.string, "user_id");
        this.assertNativeAccepted(
            await bot.setGroupCard(groupId, userId, params.card),
            "设置群名片",
        );
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
        if (!flag) throw invalidICQQParam("处理 ICQQ 群申请需要 request_id 或原始 flag", params);
        if (params.is_filtered) throw invalidICQQParam("ICQQ 不支持处理风险过滤群申请");
        if (params.approve && params.block) {
            throw invalidICQQParam("同意群申请时不能同时阻止后续申请");
        }

        const client = this.requireNativeClient(uin);
        const request = (await client.getSystemMsg()).find(
            (event): event is GroupRequestEvent | GroupInviteEvent =>
                event.request_type === "group" && event.flag === flag,
        );
        if (!request) throw icqqResourceNotFound("群申请", flag);
        if (
            params.group_id &&
            request.group_id !== this.numericId(params.group_id.string, "group_id")
        ) {
            throw invalidICQQParam("群申请不属于指定群", params.group_id.string);
        }
        if (!this.matchesGroupRequestType(request, params)) {
            throw invalidICQQParam("群申请类型与 notification_type 不一致", params);
        }

        const accepted = await client.setGroupAddRequest(
            flag,
            params.approve,
            params.reason,
            params.block,
        );
        this.assertNativeAccepted(accepted, `${params.approve ? "同意" : "拒绝"}群申请`);
    }

    private matchesGroupRequestType(
        request: GroupRequestEvent | GroupInviteEvent,
        params: Adapter.HandleGroupRequestParams,
    ): boolean {
        if (params.type === "invitation") return request.sub_type === "invite";
        if (params.sub_type === "invite") {
            return request.sub_type === "add" && request.inviter_id !== undefined;
        }
        return request.sub_type === "add" && request.inviter_id === undefined;
    }

    async getGroupNotifications(
        uin: string,
        params?: Adapter.GetGroupNotificationsParams,
    ): Promise<Adapter.GroupNotificationsResult> {
        if (params?.is_filtered) return { notifications: [] };

        const client = this.requireNativeClient(uin);
        const requests = (await client.getSystemMsg()).filter(
            (event): event is GroupRequestEvent | GroupInviteEvent =>
                event.request_type === "group",
        );
        const notifications = requests.map(event =>
            this.projectGroupNotification(event, client.uin),
        );
        const startIndex = this.resolveNotificationStart(
            notifications,
            params?.start_notification_id,
        );
        const limit = params?.limit ?? 20;
        return {
            notifications: notifications.slice(startIndex, startIndex + limit),
            next_notification_id: notifications[startIndex + limit]?.notification_id,
        };
    }

    async setGroupAvatar(uin: string, params: Adapter.SetGroupAvatarParams): Promise<void> {
        await this.requireNativeClient(uin).setGroupPortrait(
            this.numericId(params.group_id.string, "group_id"),
            resolveICQQMediaSource({ file: params.file }, "group_avatar"),
        );
    }

    private projectGroupNotification(
        event: GroupRequestEvent | GroupInviteEvent,
        selfId: number,
    ): Adapter.GroupNotification {
        const base = {
            notification_id: this.createId(event.flag),
            group_id: this.createId(event.group_id),
            is_filtered: false,
            state: "pending" as const,
        };
        if (event.sub_type === "invite") {
            return {
                ...base,
                type: "invited_join_request",
                initiator_id: this.createId(event.user_id),
                target_user_id: this.createId(selfId),
            };
        }
        if (event.inviter_id !== undefined) {
            return {
                ...base,
                type: "invited_join_request",
                initiator_id: this.createId(event.inviter_id),
                target_user_id: this.createId(event.user_id),
            };
        }
        return {
            ...base,
            type: "join_request",
            initiator_id: this.createId(event.user_id),
            comment: event.comment,
        };
    }

    private resolveNotificationStart(
        notifications: Adapter.GroupNotification[],
        start?: Adapter.GetGroupNotificationsParams["start_notification_id"],
    ): number {
        if (!start) return 0;
        const index = notifications.findIndex(
            notification =>
                notification.notification_id.string === start.string ||
                notification.notification_id.number === start.number,
        );
        if (index < 0) throw invalidICQQParam("start_notification_id 不在当前群通知列表中", start);
        return index;
    }

    async sendGroupMessageReaction(
        uin: string,
        params: Adapter.SendGroupMessageReactionParams,
    ): Promise<void> {
        const client = this.requireNativeClient(uin);
        const message = await client.getMsg(params.message_id.string);
        if (!message || message.message_type !== "group") {
            throw icqqResourceNotFound("群消息", params.message_id.string);
        }
        if (message.group_id !== this.numericId(params.group_id.string, "group_id")) {
            throw invalidICQQParam("消息不属于指定群", {
                message_id: params.message_id.string,
                group_id: params.group_id.string,
            });
        }
        const group = client.pickGroup(message.group_id);
        const reactionType = params.reaction_type === "face" ? 1 : 2;
        if (params.is_add) {
            await group.setReaction(message.seq, params.reaction, reactionType);
        } else {
            await group.delReaction(message.seq, params.reaction, reactionType);
        }
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
