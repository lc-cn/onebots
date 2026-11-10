import {
    ProtocolError,
    type Channel,
    type DirectoryQueryOptions,
    type Friend,
    type Group,
    type User,
} from "imhelper";
import {
    collectList,
    friendToDirectory,
    isRecord,
    malformed,
    parseGuildRoles,
    parseSatoriFriend,
} from "./protocol-data.js";
import type { SatoriFriend, SatoriMemberData } from "./types.js";

export type SatoriSdkCaller = <T = unknown>(
    action: string,
    params?: Record<string, unknown>,
) => Promise<T>;

/** Satori 用户、公会、成员与频道目录的 canonical DTO 边界。 */
export class SatoriDirectoryApi {
    constructor(private readonly call: SatoriSdkCaller) {}

    async getUserInfo(userId: string): Promise<User.Data<string>> {
        const data = await this.call<unknown>("user.get", { user_id: userId });
        if (!isRecord(data)) return malformed("user.get", data);
        return {
            user_id: typeof data.id === "string" ? data.id : userId,
            user_name:
                (typeof data.name === "string" && data.name) ||
                (typeof data.username === "string" ? data.username : ""),
            avatar: typeof data.avatar === "string" ? data.avatar : "",
        };
    }

    async getFriendInfo(userId: string): Promise<Friend.Data<string>> {
        const friends = await this.getFriendList();
        const friend = friends.find(item => item.user_id === userId);
        if (friend) return friend;
        throw new ProtocolError({
            protocol: "satori-v1",
            operation: "friend.list",
            kind: "validation",
            message: `Satori 好友 ${userId} 不存在`,
        });
    }

    getUserList(): Promise<User.Data<string>[]> {
        return this.getFriendList();
    }

    async getGroupInfo(groupId: string): Promise<Group.Data<string>> {
        const data = await this.call<unknown>("guild.get", { guild_id: groupId });
        if (!isRecord(data)) return malformed("guild.get", data);
        return {
            group_id: typeof data.id === "string" ? data.id : groupId,
            group_name: typeof data.name === "string" ? data.name : "",
            avatar: typeof data.avatar === "string" ? data.avatar : "",
        };
    }

    async getGroupList(): Promise<Group.Data<string>[]> {
        const guilds = await collectList("guild.list", next =>
            this.call("guild.list", next ? { next } : {}),
        );
        return guilds.map(guild => {
            if (typeof guild.id !== "string") return malformed("guild.list", guild);
            return {
                group_id: guild.id,
                group_name: typeof guild.name === "string" ? guild.name : "",
                avatar: typeof guild.avatar === "string" ? guild.avatar : "",
            };
        });
    }

    async getGroupMemberInfo(groupId: string, userId: string): Promise<SatoriMemberData> {
        const data = await this.call<unknown>("guild.member.get", {
            guild_id: groupId,
            user_id: userId,
        });
        if (!isRecord(data)) return malformed("guild.member.get", data);
        return this.toMember(data, "guild.member.get", groupId, userId);
    }

    async getGroupMemberList(groupId: string): Promise<SatoriMemberData[]> {
        const members = await collectList("guild.member.list", next =>
            this.call("guild.member.list", {
                guild_id: groupId,
                ...(next ? { next } : {}),
            }),
        );
        return members.map(item => this.toMember(item, "guild.member.list", groupId));
    }

    async getChannelList(options?: DirectoryQueryOptions<string>): Promise<Channel.Data<string>[]> {
        if (options?.scope?.type !== "guild") {
            throw new ProtocolError({
                protocol: "satori-v1",
                operation: "channel.list",
                kind: "validation",
                message: "Satori channel.list 需要 guild scope",
            });
        }
        const guildId = options.scope.id;
        const channels = await collectList("channel.list", next =>
            this.call("channel.list", {
                guild_id: guildId,
                ...(next ? { next } : {}),
            }),
        );
        return channels.map(channel => this.toChannel(channel, "channel.list", guildId));
    }

    async getChannelInfo(
        channelId: string,
        options?: DirectoryQueryOptions<string>,
    ): Promise<Channel.Data<string>> {
        const channel = await this.call<unknown>("channel.get", {
            channel_id: channelId,
            ...(options?.scope?.type === "guild" ? { guild_id: options.scope.id } : {}),
        });
        return this.toChannel(
            channel,
            "channel.get",
            options?.scope?.type === "guild" ? options.scope.id : undefined,
        );
    }

    /** 读取 /friend.list，保留官方 Friend 形状。 */
    async listFriends(): Promise<SatoriFriend[]> {
        const friends = await collectList("friend.list", next =>
            this.call("friend.list", next ? { next } : {}),
        );
        return friends.map(friend => parseSatoriFriend(friend, "friend.list"));
    }

    private async getFriendList(): Promise<Friend.Data<string>[]> {
        const friends = await this.listFriends();
        return friends.map(friend => friendToDirectory(friend, "friend.list"));
    }

    private toMember(
        item: Record<string, unknown>,
        operation: string,
        groupId: string,
        fallbackUserId?: string,
    ): SatoriMemberData {
        const user = isRecord(item.user) ? item.user : undefined;
        const userId = user?.id ?? item.user_id ?? fallbackUserId;
        if (typeof userId !== "string") return malformed(operation, item);
        const roles = parseGuildRoles(item.roles, operation);
        const userName =
            (typeof user?.nick === "string" && user.nick) ||
            (typeof user?.name === "string" && user.name) ||
            (typeof item.nick === "string" && item.nick) ||
            (typeof item.nickname === "string" ? item.nickname : "");
        return {
            user_id: userId,
            user_name: userName,
            avatar:
                (typeof user?.avatar === "string" && user.avatar) ||
                (typeof item.avatar === "string" ? item.avatar : ""),
            group_id: groupId,
            ...(roles ? { roles } : {}),
        };
    }

    private toChannel(value: unknown, operation: string, guildId?: string): Channel.Data<string> {
        if (!isRecord(value) || typeof value.id !== "string") {
            return malformed(operation, value);
        }
        return {
            channel_id: value.id,
            guild_id: guildId,
            channel_name: typeof value.name === "string" ? value.name : "",
            avatar: typeof value.avatar === "string" ? value.avatar : "",
        };
    }
}
