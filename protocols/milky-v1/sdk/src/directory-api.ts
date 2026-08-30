import {
    ProtocolError,
    type DirectoryQueryOptions,
    type Friend,
    type Group,
    type GroupMember,
    type User,
} from "imhelper";
import type { MilkyV1Response } from "./types.js";

export type MilkySdkCaller = <T = unknown>(
    action: string,
    params?: Record<string, unknown>,
) => Promise<MilkyV1Response<T>>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function malformed(operation: string, response: MilkyV1Response<unknown>): never {
    throw new ProtocolError({
        protocol: "milky-v1",
        operation,
        kind: "protocol",
        message: `Milky ${operation} 返回了无效的数据结构`,
        response,
    });
}

/** Milky 目录读取与 canonical 实体投影的唯一边界。 */
export class MilkyDirectoryApi {
    constructor(private readonly call: MilkySdkCaller) {}

    async getUserInfo(userId: string, options?: DirectoryQueryOptions): Promise<User.Data<string>> {
        const response = await this.call<Record<string, unknown>>("get_user_profile", {
            user_id: Number(userId),
            no_cache: options?.fresh ?? false,
        });
        if (response.status !== "ok" || !response.data) {
            return malformed("get_user_profile", response);
        }
        return {
            user_id: String(response.data.user_id ?? userId),
            user_name: (response.data.nickname as string) ?? "",
            avatar: (response.data.avatar_url as string) ?? "",
        };
    }

    async getFriendInfo(
        userId: string,
        options?: DirectoryQueryOptions,
    ): Promise<Friend.Data<string>> {
        const response = await this.call<Record<string, unknown>>("get_friend_info", {
            user_id: Number(userId),
            no_cache: options?.fresh ?? false,
        });
        if (response.status !== "ok" || !response.data) {
            return malformed("get_friend_info", response);
        }
        const friend = isRecord(response.data.friend) ? response.data.friend : response.data;
        return {
            user_id: String(friend.user_id ?? userId),
            user_name: (friend.nickname as string) ?? "",
            avatar: (friend.avatar_url as string) ?? "",
            remark: (friend.remark as string) ?? "",
        };
    }

    async getUserList(options?: DirectoryQueryOptions): Promise<User.Data<string>[]> {
        const response = await this.call<unknown>("get_friend_list", {
            no_cache: options?.fresh ?? false,
        });
        if (response.status !== "ok") return malformed("get_friend_list", response);
        const friends = Array.isArray(response.data)
            ? response.data
            : isRecord(response.data) && Array.isArray(response.data.friends)
              ? response.data.friends
              : malformed("get_friend_list", response);
        return friends.filter(isRecord).map(friend => ({
            user_id: String(friend.user_id),
            user_name: (friend.nickname as string) ?? "",
            avatar: (friend.avatar_url as string) ?? "",
        }));
    }

    async getGroupInfo(
        groupId: string,
        options?: DirectoryQueryOptions,
    ): Promise<Group.Data<string>> {
        const response = await this.call<Record<string, unknown>>("get_group_info", {
            group_id: Number(groupId),
            no_cache: options?.fresh ?? false,
        });
        if (response.status !== "ok" || !response.data) {
            return malformed("get_group_info", response);
        }
        const group = isRecord(response.data.group) ? response.data.group : response.data;
        return {
            group_id: String(group.group_id ?? groupId),
            group_name: (group.group_name as string) ?? "",
            avatar: (group.avatar_url as string) ?? "",
        };
    }

    async getGroupList(options?: DirectoryQueryOptions): Promise<Group.Data<string>[]> {
        const response = await this.call<unknown>("get_group_list", {
            no_cache: options?.fresh ?? false,
        });
        if (response.status !== "ok") return malformed("get_group_list", response);
        const groups = Array.isArray(response.data)
            ? response.data
            : isRecord(response.data) && Array.isArray(response.data.groups)
              ? response.data.groups
              : malformed("get_group_list", response);
        return groups.filter(isRecord).map(group => ({
            group_id: String(group.group_id),
            group_name: (group.group_name as string) ?? "",
            avatar: (group.avatar_url as string) ?? "",
        }));
    }

    async getGroupMemberInfo(
        groupId: string,
        userId: string,
        options?: DirectoryQueryOptions,
    ): Promise<GroupMember.Data<string>> {
        const response = await this.call<Record<string, unknown>>("get_group_member_info", {
            group_id: Number(groupId),
            user_id: Number(userId),
            no_cache: options?.fresh ?? false,
        });
        if (response.status !== "ok" || !response.data) {
            return malformed("get_group_member_info", response);
        }
        const member = isRecord(response.data.member) ? response.data.member : response.data;
        return {
            user_id: String(member.user_id ?? userId),
            user_name: (member.card as string) ?? (member.nickname as string) ?? "",
            avatar: (member.avatar_url as string) ?? "",
            group_id: groupId,
            role: member.role as GroupMember.Data<string>["role"],
        };
    }

    async getGroupMemberList(
        groupId: string,
        options?: DirectoryQueryOptions,
    ): Promise<GroupMember.Data<string>[]> {
        const response = await this.call<unknown>("get_group_member_list", {
            group_id: Number(groupId),
            no_cache: options?.fresh ?? false,
        });
        if (response.status !== "ok") return malformed("get_group_member_list", response);
        const members = Array.isArray(response.data)
            ? response.data
            : isRecord(response.data) && Array.isArray(response.data.members)
              ? response.data.members
              : malformed("get_group_member_list", response);
        return members.filter(isRecord).map(member => ({
            user_id: String(member.user_id),
            user_name: (member.card as string) ?? (member.nickname as string) ?? "",
            avatar: (member.avatar_url as string) ?? "",
            group_id: groupId,
            role: member.role as GroupMember.Data<string>["role"],
        }));
    }
}
