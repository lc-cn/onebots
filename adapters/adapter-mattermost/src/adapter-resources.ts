import { Adapter, BaseApp, type AdapterCapabilityManifest, type CommonTypes } from "onebots";
import { channelRole, displayName, teamRole } from "./adapter-support.js";
import { describeMattermostCapabilities, mattermostCapabilities } from "./capabilities.js";
import { MattermostClient } from "./client.js";
import { MattermostError } from "./errors.js";
import { projectMattermostPost } from "./messages.js";
import type {
    MattermostChannel,
    MattermostChannelMember,
    MattermostTeamMember,
    MattermostUser,
} from "./types.js";

/** canonical 用户、群组、团队和频道资源域。 */
export abstract class MattermostResourceAdapter extends Adapter<MattermostClient, "mattermost"> {
    constructor(app: BaseApp) {
        super(app, "mattermost", mattermostCapabilities);
        this.icon = "https://mattermost.com/wp-content/uploads/2022/02/icon.png";
    }

    describeCapabilities(uin?: string): AdapterCapabilityManifest {
        const client = uin ? this.getAccount(uin)?.client : undefined;
        return client
            ? describeMattermostCapabilities(client.config, client.isConnected)
            : mattermostCapabilities;
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        return this.userInfo(client.me || (await client.getMe()));
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.userInfo(await this.requireClient(uin).getUser(params.user_id.string));
    }

    async createUserChannel(
        uin: string,
        params: Adapter.CreateUserChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        return this.channelInfo(
            await this.requireClient(uin).createDirectChannel(params.user_id.string),
        );
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const client = this.requireClient(uin);
        const channel = await client.getChannel(params.group_id.string);
        this.assertGroupChannel(channel);
        const members = await client.listAllChannelMembers(channel.id);
        return {
            group_id: this.createId(channel.id),
            group_name: channel.display_name || channel.name,
            member_count: members.length,
            created_time: Math.floor(channel.create_at / 1_000),
            description: channel.purpose,
            announcement: channel.header,
        };
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const client = this.requireClient(uin);
        const channel = await client.getChannel(params.group_id.string);
        this.assertGroupChannel(channel);
        const members = await client.listAllChannelMembers(channel.id);
        const users = await client.getUsersByIds(members.map(member => member.user_id));
        const byId = new Map(users.map(user => [user.id, user]));
        return members.map(member =>
            this.groupMemberInfo(
                params.group_id,
                member,
                this.requireMappedUser(byId, member.user_id),
            ),
        );
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const client = this.requireClient(uin);
        const channel = await client.getChannel(params.group_id.string);
        this.assertGroupChannel(channel);
        const [member, user] = await Promise.all([
            client.getChannelMember(channel.id, params.user_id.string),
            client.getUser(params.user_id.string),
        ]);
        return this.groupMemberInfo(params.group_id, member, user);
    }

    async sendGroupMessageReaction(
        uin: string,
        params: Adapter.SendGroupMessageReactionParams,
    ): Promise<void> {
        const client = this.requireClient(uin);
        if (params.reaction_type !== "emoji") {
            throw MattermostError.invalid("Mattermost reaction_type 仅支持 emoji");
        }
        if (params.is_add) await client.addReaction(params.message_id.string, params.reaction);
        else await client.removeReaction(params.message_id.string, params.reaction);
    }

    async getGroupEssenceMessages(
        uin: string,
        params: Adapter.GetGroupEssenceMessagesParams,
    ): Promise<Adapter.GroupEssenceMessage[]> {
        const client = this.requireClient(uin);
        const posts = await client.getPinnedPosts(params.group_id.string);
        const slice = posts.order.slice(
            params.page_index * params.page_size,
            (params.page_index + 1) * params.page_size,
        );
        const userIds = [...new Set(slice.map(id => posts.posts[id].user_id))];
        const users = new Map((await client.getUsersByIds(userIds)).map(user => [user.id, user]));
        return slice.map(id => {
            const post = posts.posts[id];
            const senderName = users.get(post.user_id)
                ? displayName(users.get(post.user_id)!)
                : post.user_id;
            return {
                group_id: params.group_id,
                message_id: this.createId(post.id),
                message_time: Math.floor(post.create_at / 1_000),
                sender_id: this.createId(post.user_id),
                sender_name: senderName,
                operator_id: this.createId(post.user_id),
                operator_name: senderName,
                operation_time: Math.floor((post.update_at || post.create_at) / 1_000),
                message: projectMattermostPost(post),
            };
        });
    }

    async setGroupEssenceMessage(
        uin: string,
        params: Adapter.SetGroupEssenceMessageParams,
    ): Promise<void> {
        await this.requireClient(uin).pinPost(params.message_id.string, true);
    }

    async deleteGroupEssenceMessage(
        uin: string,
        params: Adapter.DeleteGroupEssenceMessageParams,
    ): Promise<void> {
        await this.requireClient(uin).pinPost(params.message_id.string, false);
    }

    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        return (await this.requireClient(uin).listTeams()).map(team => ({
            guild_id: this.createId(team.id),
            guild_name: team.name,
            guild_display_name: team.display_name,
        }));
    }

    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const team = await this.requireClient(uin).getTeam(params.guild_id.string);
        return {
            guild_id: this.createId(team.id),
            guild_name: team.name,
            guild_display_name: team.display_name,
        };
    }

    async getGuildMemberList(
        uin: string,
        params: Adapter.GetGuildMemberListParams,
    ): Promise<Adapter.GuildMemberInfo[]> {
        const client = this.requireClient(uin);
        const members = await client.listAllTeamMembers(params.guild_id.string);
        const users = await client.getUsersByIds(members.map(member => member.user_id));
        const byId = new Map(users.map(user => [user.id, user]));
        return members.map(member =>
            this.guildMemberInfo(
                params.guild_id,
                member,
                this.requireMappedUser(byId, member.user_id),
            ),
        );
    }

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const client = this.requireClient(uin);
        const [member, user] = await Promise.all([
            client.getTeamMember(params.guild_id.string, params.user_id.string),
            client.getUser(params.user_id.string),
        ]);
        return this.guildMemberInfo(params.guild_id, member, user);
    }

    async getChannelList(
        uin: string,
        params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        if (!params?.guild_id) throw MattermostError.invalid("get_channel_list 必须提供 guild_id");
        return (await this.requireClient(uin).listChannels(params.guild_id.string))
            .filter(channel => channel.type === "O" || channel.type === "P")
            .map(channel => this.channelInfo(channel));
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        return this.channelInfo(await this.requireClient(uin).getChannel(params.channel_id.string));
    }

    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        return this.channelInfo(
            await this.requireClient(uin).createChannel({
                team_id: params.guild_id.string,
                name: channelSlug(params.channel_name),
                display_name: params.channel_name,
                type: params.channel_type === 1 ? "P" : "O",
            }),
        );
    }

    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        if (!params.channel_name) {
            throw MattermostError.invalid("Mattermost update_channel 需要 channel_name");
        }
        await this.requireClient(uin).patchChannel(params.channel_id.string, {
            name: channelSlug(params.channel_name),
            display_name: params.channel_name,
        });
    }

    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        await this.requireClient(uin).archiveChannel(params.channel_id.string);
    }

    async getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        const client = this.requireClient(uin);
        const members = await client.listAllChannelMembers(params.channel_id.string);
        const users = await client.getUsersByIds(members.map(member => member.user_id));
        const byId = new Map(users.map(user => [user.id, user]));
        return members.map(member =>
            this.channelMemberInfo(
                params.channel_id,
                member,
                this.requireMappedUser(byId, member.user_id),
            ),
        );
    }

    async getChannelMemberInfo(
        uin: string,
        params: Adapter.GetChannelMemberInfoParams,
    ): Promise<Adapter.ChannelMemberInfo> {
        const client = this.requireClient(uin);
        const [member, user] = await Promise.all([
            client.getChannelMember(params.channel_id.string, params.user_id.string),
            client.getUser(params.user_id.string),
        ]);
        return this.channelMemberInfo(params.channel_id, member, user);
    }

    async inviteChannelMember(
        uin: string,
        params: Adapter.InviteChannelMemberParams,
    ): Promise<void> {
        await this.requireClient(uin).addChannelMember(
            params.channel_id.string,
            params.user_id.string,
        );
    }

    async kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        await this.requireClient(uin).removeChannelMember(
            params.channel_id.string,
            params.user_id.string,
        );
    }

    protected requireClient(uin: string): MattermostClient {
        const client = this.getAccount(uin)?.client;
        if (!client) {
            throw new MattermostError(`Mattermost 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
                status: 404,
            });
        }
        return client;
    }

    private userInfo(user: MattermostUser): Adapter.UserInfo {
        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            user_displayname: displayName(user),
            remark: user.nickname,
            bio: user.position,
        };
    }

    private guildMemberInfo(
        guildId: CommonTypes.Id,
        member: MattermostTeamMember,
        user: MattermostUser,
    ): Adapter.GuildMemberInfo {
        return {
            guild_id: guildId,
            user_id: this.createId(user.id),
            user_name: user.username,
            nickname: displayName(user),
            role: teamRole(member),
        };
    }

    private channelMemberInfo(
        channelId: CommonTypes.Id,
        member: MattermostChannelMember,
        user: MattermostUser,
    ): Adapter.ChannelMemberInfo {
        return {
            channel_id: channelId,
            user_id: this.createId(user.id),
            user_name: user.username,
            role: channelRole(member),
        };
    }

    private groupMemberInfo(
        groupId: CommonTypes.Id,
        member: MattermostChannelMember,
        user: MattermostUser,
    ): Adapter.GroupMemberInfo {
        return {
            group_id: groupId,
            user_id: this.createId(user.id),
            user_name: user.username,
            card: displayName(user),
            role: channelRole(member),
        };
    }

    private channelInfo(channel: MattermostChannel): Adapter.ChannelInfo {
        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.display_name || channel.name,
            channel_type: { O: 0, P: 1, D: 2, G: 3 }[channel.type],
        };
    }

    private assertGroupChannel(channel: MattermostChannel): void {
        if (channel.type !== "G") {
            throw MattermostError.invalid("该资源不是 Mattermost Group Message channel");
        }
    }

    private requireMappedUser(
        users: ReadonlyMap<string, MattermostUser>,
        userId: string,
    ): MattermostUser {
        const user = users.get(userId);
        if (!user) throw MattermostError.invalid(`Mattermost 成员 ${userId} 缺少用户资料`);
        return user;
    }
}

function channelSlug(value: string): string {
    const slug = value
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 64);
    if (!slug) throw MattermostError.invalid("channel_name 无法生成有效 Mattermost name");
    return slug;
}
