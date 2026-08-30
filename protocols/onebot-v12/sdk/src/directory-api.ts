import {
    ProtocolError,
    type Channel,
    type ChannelMember,
    type DirectoryQueryOptions,
    type Friend,
    type Group,
    type GroupMember,
    type User,
} from "imhelper";
import type { OneBotV12Response } from "./types.js";

export type OneBotV12SdkCaller = <T = unknown>(
    action: string,
    params?: Record<string, unknown>,
) => Promise<OneBotV12Response<T>>;

function malformed(action: string, response: OneBotV12Response<unknown>): never {
    throw new ProtocolError({
        protocol: "onebot-v12",
        operation: action,
        kind: "protocol",
        message: `OneBot V12 ${action} 返回了无效的数据结构`,
        response,
    });
}

function responseRecord(
    action: string,
    response: OneBotV12Response<unknown>,
): Record<string, unknown> {
    return typeof response.data === "object" &&
        response.data !== null &&
        !Array.isArray(response.data)
        ? (response.data as Record<string, unknown>)
        : malformed(action, response);
}

function responseRecords(
    action: string,
    response: OneBotV12Response<unknown>,
): Record<string, unknown>[] {
    if (!Array.isArray(response.data)) return malformed(action, response);
    return response.data.map(item => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
            return malformed(action, response);
        }
        return item as Record<string, unknown>;
    });
}

function userName(data: Record<string, unknown>): string | undefined {
    if (typeof data.user_name === "string") return data.user_name;
    if (typeof data.nickname === "string") return data.nickname;
    if (typeof data.user_displayname === "string") return data.user_displayname;
    return undefined;
}

/** OneBot 12 目录边界；统一校验响应并维护 Channel -> Guild 的显式地址关系。 */
export class OneBotV12DirectoryApi {
    constructor(
        private readonly call: OneBotV12SdkCaller,
        private readonly channelGuilds: Map<string, string>,
    ) {}

    async getUserInfo(userId: string): Promise<User.Data<string>> {
        const response = await this.call("get_user_info", { user_id: userId });
        const data = responseRecord("get_user_info", response);
        return {
            user_id: typeof data.user_id === "string" ? data.user_id : userId,
            user_name: userName(data),
            avatar: typeof data.avatar === "string" ? data.avatar : undefined,
        };
    }

    async getFriendInfo(userId: string): Promise<Friend.Data<string>> {
        const friends = await this.getFriendList();
        const friend = friends.find(item => item.user_id === userId);
        if (friend) return friend;
        throw new ProtocolError({
            protocol: "onebot-v12",
            operation: "get_friend_list",
            kind: "validation",
            message: `OneBot V12 好友 ${userId} 不存在`,
        });
    }

    getUserList(): Promise<User.Data<string>[]> {
        return this.getFriendList();
    }

    async getGroupInfo(groupId: string): Promise<Group.Data<string>> {
        const response = await this.call("get_group_info", { group_id: groupId });
        const data = responseRecord("get_group_info", response);
        return {
            group_id: typeof data.group_id === "string" ? data.group_id : groupId,
            group_name: typeof data.group_name === "string" ? data.group_name : undefined,
            avatar: typeof data.avatar === "string" ? data.avatar : undefined,
        };
    }

    async getGroupList(): Promise<Group.Data<string>[]> {
        const response = await this.call("get_group_list", {});
        return responseRecords("get_group_list", response).map(data => {
            if (typeof data.group_id !== "string") return malformed("get_group_list", response);
            return {
                group_id: data.group_id,
                group_name: typeof data.group_name === "string" ? data.group_name : undefined,
                avatar: typeof data.avatar === "string" ? data.avatar : undefined,
            };
        });
    }

    async getGroupMemberInfo(groupId: string, userId: string): Promise<GroupMember.Data<string>> {
        const response = await this.call("get_group_member_info", {
            group_id: groupId,
            user_id: userId,
        });
        return this.toGroupMember(
            responseRecord("get_group_member_info", response),
            groupId,
            userId,
        );
    }

    async getGroupMemberList(groupId: string): Promise<GroupMember.Data<string>[]> {
        const response = await this.call("get_group_member_list", { group_id: groupId });
        return responseRecords("get_group_member_list", response).map(data => {
            if (typeof data.user_id !== "string") {
                return malformed("get_group_member_list", response);
            }
            return this.toGroupMember(data, groupId, data.user_id);
        });
    }

    async getChannelList(options?: DirectoryQueryOptions<string>): Promise<Channel.Data<string>[]> {
        const guildId = this.requireGuildScope("get_channel_list", options);
        const response = await this.call("get_channel_list", { guild_id: guildId });
        return responseRecords("get_channel_list", response).map(data =>
            this.toChannel("get_channel_list", data, guildId, response),
        );
    }

    async getChannelInfo(
        channelId: string,
        options?: DirectoryQueryOptions<string>,
    ): Promise<Channel.Data<string>> {
        const guildId = this.resolveGuild("get_channel_info", channelId, options);
        const response = await this.call("get_channel_info", {
            guild_id: guildId,
            channel_id: channelId,
        });
        return this.toChannel(
            "get_channel_info",
            responseRecord("get_channel_info", response),
            guildId,
            response,
        );
    }

    async getChannelMemberInfo(
        channelId: string,
        userId: string,
    ): Promise<ChannelMember.Data<string>> {
        const guildId = this.resolveGuild("get_channel_member_info", channelId);
        const response = await this.call("get_channel_member_info", {
            guild_id: guildId,
            channel_id: channelId,
            user_id: userId,
        });
        return this.toChannelMember(
            responseRecord("get_channel_member_info", response),
            channelId,
            userId,
        );
    }

    async getChannelMemberList(channelId: string): Promise<ChannelMember.Data<string>[]> {
        const guildId = this.resolveGuild("get_channel_member_list", channelId);
        const response = await this.call("get_channel_member_list", {
            guild_id: guildId,
            channel_id: channelId,
        });
        return responseRecords("get_channel_member_list", response).map(data => {
            if (typeof data.user_id !== "string") {
                return malformed("get_channel_member_list", response);
            }
            return this.toChannelMember(data, channelId, data.user_id);
        });
    }

    resolveGuild(
        operation: string,
        channelId: string,
        options?: DirectoryQueryOptions<string>,
    ): string {
        const scoped = options?.scope?.type === "guild" ? options.scope.id : undefined;
        const guildId = scoped ?? this.channelGuilds.get(channelId);
        if (guildId) return guildId;
        throw new ProtocolError({
            protocol: "onebot-v12",
            operation,
            kind: "validation",
            message: `OneBot V12 ${operation} 需要 channel ${channelId} 的 guild 上下文`,
        });
    }

    private async getFriendList(): Promise<Friend.Data<string>[]> {
        const response = await this.call("get_friend_list", {});
        return responseRecords("get_friend_list", response).map(data => {
            if (typeof data.user_id !== "string") return malformed("get_friend_list", response);
            return {
                user_id: data.user_id,
                user_name: userName(data),
                avatar: typeof data.avatar === "string" ? data.avatar : undefined,
                remark:
                    (typeof data.user_remark === "string" && data.user_remark) ||
                    (typeof data.remark === "string" ? data.remark : undefined),
            };
        });
    }

    private requireGuildScope(operation: string, options?: DirectoryQueryOptions<string>): string {
        if (options?.scope?.type === "guild") return options.scope.id;
        throw new ProtocolError({
            protocol: "onebot-v12",
            operation,
            kind: "validation",
            message: `OneBot V12 ${operation} 需要 guild scope`,
        });
    }

    private toChannel(
        operation: string,
        data: Record<string, unknown>,
        guildId: string,
        response: OneBotV12Response<unknown>,
    ): Channel.Data<string> {
        if (typeof data.channel_id !== "string") return malformed(operation, response);
        this.channelGuilds.set(data.channel_id, guildId);
        return {
            channel_id: data.channel_id,
            guild_id: guildId,
            channel_name: typeof data.channel_name === "string" ? data.channel_name : undefined,
            avatar: typeof data.avatar === "string" ? data.avatar : undefined,
        };
    }

    private toGroupMember(
        data: Record<string, unknown>,
        groupId: string,
        fallbackUserId: string,
    ): GroupMember.Data<string> {
        const role = data.role;
        return {
            user_id: typeof data.user_id === "string" ? data.user_id : fallbackUserId,
            user_name: userName(data),
            avatar: typeof data.avatar === "string" ? data.avatar : undefined,
            group_id: groupId,
            role: role === "owner" || role === "admin" || role === "member" ? role : undefined,
        };
    }

    private toChannelMember(
        data: Record<string, unknown>,
        channelId: string,
        fallbackUserId: string,
    ): ChannelMember.Data<string> {
        const role = data.role;
        return {
            user_id: typeof data.user_id === "string" ? data.user_id : fallbackUserId,
            user_name: userName(data),
            avatar: typeof data.avatar === "string" ? data.avatar : undefined,
            channel_id: channelId,
            role: role === "owner" || role === "admin" || role === "member" ? role : undefined,
        };
    }
}
