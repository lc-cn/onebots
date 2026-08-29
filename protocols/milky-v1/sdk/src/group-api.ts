import type { MilkySdkCaller } from "./directory-api.js";

export interface FriendRequestContext {
    initiatorUid: string;
    isFiltered: boolean;
}

export type GroupRequestContext =
    | {
          kind: "request";
          notificationSeq: number;
          notificationType: "join_request" | "invited_join_request";
          groupId: number;
          isFiltered: boolean;
      }
    | { kind: "invitation"; invitationSeq: number; groupId: number };

/** 群管理及申请上下文的唯一协议动作边界。 */
export class MilkyGroupApi {
    constructor(
        private readonly call: MilkySdkCaller,
        private readonly friendRequests: Map<string, FriendRequestContext>,
        private readonly groupRequests: Map<string, GroupRequestContext>,
    ) {}

    async kickMember(groupId: string, userId: string): Promise<void> {
        await this.call("kick_group_member", {
            group_id: Number(groupId),
            user_id: Number(userId),
            reject_add_request: false,
        });
    }

    async inviteFriend(groupId: string, userId: string): Promise<void> {
        await this.call("invite_friend_to_group", {
            group_id: Number(groupId),
            user_id: Number(userId),
        });
    }

    async muteMember(groupId: string, userId: string, duration: number): Promise<void> {
        await this.call("set_group_member_mute", {
            group_id: Number(groupId),
            user_id: Number(userId),
            duration,
        });
    }

    async setMemberAdmin(groupId: string, userId: string, admin: boolean): Promise<void> {
        await this.call("set_group_member_admin", {
            group_id: Number(groupId),
            user_id: Number(userId),
            enable: admin,
        });
    }

    async setMemberCard(groupId: string, userId: string, card: string): Promise<void> {
        await this.call("set_group_member_card", {
            group_id: Number(groupId),
            user_id: Number(userId),
            card,
        });
    }

    async setName(groupId: string, name: string): Promise<void> {
        await this.call("set_group_name", { group_id: Number(groupId), new_group_name: name });
    }

    async leave(groupId: string): Promise<void> {
        await this.call("quit_group", { group_id: Number(groupId), is_dismiss: false });
    }

    async approveFriendRequest(requestId: string, approve: boolean): Promise<void> {
        const context = this.friendRequests.get(requestId);
        if (!context) throw new TypeError(`未知的 Milky 好友请求：${requestId}`);
        await this.call(approve ? "accept_friend_request" : "reject_friend_request", {
            initiator_uid: context.initiatorUid,
            is_filtered: context.isFiltered,
        });
        this.friendRequests.delete(requestId);
    }

    async acceptFriendRequest(
        initiatorUid: string,
        isFiltered = false,
        remark?: string,
    ): Promise<void> {
        await this.call("accept_friend_request", {
            initiator_uid: initiatorUid,
            is_filtered: isFiltered,
            ...(remark === undefined ? {} : { remark }),
        });
    }

    async approveGroupRequest(requestId: string, approve: boolean, reason?: string): Promise<void> {
        const context = this.groupRequests.get(requestId);
        if (!context) throw new TypeError(`未知的 Milky 群请求：${requestId}`);
        if (context.kind === "invitation") {
            await this.call(approve ? "accept_group_invitation" : "reject_group_invitation", {
                group_id: context.groupId,
                invitation_seq: context.invitationSeq,
            });
        } else {
            await this.call(approve ? "accept_group_request" : "reject_group_request", {
                notification_seq: context.notificationSeq,
                notification_type: context.notificationType,
                group_id: context.groupId,
                is_filtered: context.isFiltered,
                ...(approve ? {} : { reason }),
            });
        }
        this.groupRequests.delete(requestId);
    }
}
