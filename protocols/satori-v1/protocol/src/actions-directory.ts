import type { Account, Adapter } from "onebots";
import type { SatoriChannelRouteRegistry } from "./channel-routes.js";
import { Satori } from "./types.js";

/** 公会、成员、用户、好友与登录资源动作。 */
export class SatoriDirectoryActions {
    constructor(
        private readonly adapter: Adapter,
        private readonly account: Account,
        private readonly channelRoutes: SatoriChannelRouteRegistry,
    ) {}

    /**
     * guild.get - Get guild information
     * 使用真实 Guild API，不从 Group 模型猜测服务器。
     */
    async getGuild(params: Record<string, unknown>): Promise<Satori.Guild> {
        const { guild_id } = params as { guild_id: string };

        const info = await this.adapter.getGuildInfo(this.account.account_id, {
            guild_id: this.adapter.resolveId(guild_id),
        });

        return {
            id: info.guild_id.string,
            name: info.guild_display_name ?? info.guild_name,
        };
    }

    /**
     * guild.list - Get guild list
     * 返回平台真实 Guild 列表。
     */
    async getGuildList(_params: Record<string, unknown>): Promise<Satori.List<Satori.Guild>> {
        const guilds = await this.adapter.getGuildList(this.account.account_id);

        return {
            data: guilds.map(guild => ({
                id: guild.guild_id.string,
                name: guild.guild_display_name ?? guild.guild_name,
            })),
        };
    }

    /**
     * guild.member.get - Get guild member information
     */
    async getGuildMember(params: Record<string, unknown>): Promise<Satori.GuildMember> {
        const { guild_id, user_id } = params as { guild_id: string; user_id: string };

        const info = await this.adapter.getGuildMemberInfo(this.account.account_id, {
            guild_id: this.adapter.resolveId(guild_id),
            user_id: this.adapter.resolveId(user_id),
        });

        return {
            user: {
                id: info.user_id.string,
                name: info.user_name,
            },
            nick: info.nickname,
        };
    }

    /**
     * guild.member.list - Get guild member list
     */
    async getGuildMemberList(
        params: Record<string, unknown>,
    ): Promise<Satori.List<Satori.GuildMember>> {
        const { guild_id } = params as { guild_id: string };

        const members = await this.adapter.getGuildMemberList(this.account.account_id, {
            guild_id: this.adapter.resolveId(guild_id),
        });

        return {
            data: members.map(m => ({
                user: {
                    id: m.user_id.string,
                    name: m.user_name,
                },
                nick: m.nickname,
            })),
        };
    }

    /**
     * guild.member.kick - Kick a member from guild
     */
    async kickGuildMember(params: Record<string, unknown>): Promise<void> {
        const action = "guild.member.kick";
        if (!this.adapter.describeCapabilities(this.account.account_id).actions[action]) {
            throw new Error(`${action} not implemented`);
        }
        await this.adapter.callAction(this.account.account_id, action, params);
    }

    /**
     * guild.member.mute - Mute a guild member
     */
    async muteGuildMember(params: Record<string, unknown>): Promise<void> {
        const action = "guild.member.mute";
        if (!this.adapter.describeCapabilities(this.account.account_id).actions[action]) {
            throw new Error(`${action} not implemented`);
        }
        await this.adapter.callAction(this.account.account_id, action, params);
    }

    /**
     * user.get - Get user information
     */
    async getUser(params: Record<string, unknown>): Promise<Satori.User> {
        const { user_id } = params as { user_id: string };

        const info = await this.adapter.getUserInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(user_id),
        });

        return {
            id: info.user_id.string,
            name: info.user_name,
        };
    }

    /**
     * user.channel.create - Create a direct message channel with a user
     */
    async createDirectChannel(params: Record<string, unknown>): Promise<Satori.Channel> {
        const { user_id, guild_id } = params as { user_id: string; guild_id?: string };

        const channel = await this.adapter.createUserChannel(this.account.account_id, {
            user_id: this.adapter.resolveId(user_id),
            guild_id: guild_id ? this.adapter.resolveId(guild_id) : undefined,
        });
        this.channelRoutes.rememberDirectoryChannel(channel.channel_id.string, "direct", guild_id);

        return {
            id: channel.channel_id.string,
            type: 1, // Direct/private channel
            name: channel.channel_name,
        };
    }

    /**
     * friend.list - Get friend list
     */
    async getFriendList(_params: Record<string, unknown>): Promise<Satori.List<Satori.User>> {
        const friends = await this.adapter.getFriendList(this.account.account_id);

        return {
            data: friends.map(f => ({
                id: f.user_id.string,
                name: f.user_name,
            })),
        };
    }

    /**
     * friend.delete - Delete a friend
     */
    async deleteFriend(params: Record<string, unknown>): Promise<void> {
        const { user_id } = params as { user_id: string };

        await this.adapter.deleteFriend(this.account.account_id, {
            user_id: this.adapter.resolveId(user_id),
        });
    }

    /** friend.approve - Handle a friend request. */
    async approveFriend(params: Record<string, unknown>): Promise<void> {
        const { message_id, approve, comment } = params as {
            message_id: string;
            approve: boolean;
            comment?: string;
        };

        await this.adapter.handleFriendRequest(this.account.account_id, {
            request_id: this.adapter.resolveId(message_id),
            approve,
            remark: comment,
            reason: comment,
        });
    }

    /** guild.approve - Handle an invitation for the bot to join a guild. */
    async approveGuild(params: Record<string, unknown>): Promise<void> {
        return this.handleGuildRequest(params, "invitation");
    }

    /** guild.member.approve - Handle a user's request to join a guild. */
    async approveGuildMember(params: Record<string, unknown>): Promise<void> {
        return this.handleGuildRequest(params, "request");
    }

    private async handleGuildRequest(
        params: Record<string, unknown>,
        type: "request" | "invitation",
    ): Promise<void> {
        const { message_id, approve, comment } = params as {
            message_id: string;
            approve: boolean;
            comment?: string;
        };

        await this.adapter.handleGroupRequest(this.account.account_id, {
            request_id: this.adapter.resolveId(message_id),
            type,
            approve,
            reason: comment,
        });
    }

    /**
     * login.get - Get login (bot) information
     */
    async getLogin(): Promise<Satori.Login> {
        const info = await this.adapter.getLoginInfo(this.account.account_id);

        return {
            user: {
                id: info.user_id.string,
                name: info.user_name,
            },
            self_id: info.user_id.string,
            platform: this.account.platform as string,
            status: 1, // Online
        };
    }
}
