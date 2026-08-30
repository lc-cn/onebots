import { Adapter } from "onebots";
import { SlackError } from "./errors.js";
import { SlackMessageActions } from "./message-actions.js";
import { slackUserDisplayName } from "./users.js";

/** Slack 用户目录、频道与成员管理动作。 */
export abstract class SlackDirectoryActions extends SlackMessageActions {
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const me = this.requireAccount(uin).client.getCachedMe();
        return {
            user_id: this.createId(me?.id || ""),
            user_name: me?.name || "",
            user_displayname: slackUserDisplayName(me),
            avatar: me?.profile?.image_512 || me?.profile?.image_192,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const user = await this.requireAccount(uin).client.getUserInfo(params.user_id.string);
        return {
            user_id: this.createId(user.id),
            user_name: user.name || "",
            user_displayname: slackUserDisplayName(user),
            avatar: user.profile?.image_512 || user.profile?.image_192,
        };
    }

    async getFriendList(
        uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        const users = await this.requireAccount(uin).client.getUserList();
        return users
            .filter(user => !user.is_bot && !user.is_app_user && !user.deleted)
            .map(user => ({
                user_id: this.createId(user.id),
                user_name: user.name || "",
                remark: slackUserDisplayName(user),
            }));
    }

    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const user = await this.requireAccount(uin).client.getUserInfo(params.user_id.string);
        return {
            user_id: this.createId(user.id),
            user_name: user.name || "",
            remark: slackUserDisplayName(user),
        };
    }

    async getChannelList(
        uin: string,
        _params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        const channels = await this.requireAccount(uin).client.getChannelList();
        return channels.map(channel => ({
            channel_id: this.createId(channel.id),
            channel_name: channel.name || "",
        }));
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const channel = await this.requireAccount(uin).client.getChannelInfo(
            params.channel_id.string,
        );
        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name || "",
        };
    }

    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const channel = await this.requireAccount(uin).client.createChannel(params.channel_name);
        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
        };
    }

    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        if (params.parent_id) {
            throw SlackError.invalid(
                "Slack 不支持移动频道层级",
                "SLACK_CHANNEL_PARENT_UNSUPPORTED",
            );
        }
        if (!params.channel_name) {
            throw SlackError.invalid(
                "Slack 更新频道需要 channel_name",
                "SLACK_CHANNEL_NAME_REQUIRED",
            );
        }
        await this.requireAccount(uin).client.call("conversations.rename", {
            channel: params.channel_id.string,
            name: params.channel_name,
        });
    }

    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        await this.requireAccount(uin).client.call("conversations.archive", {
            channel: params.channel_id.string,
        });
    }

    async inviteChannelMember(
        uin: string,
        params: Adapter.InviteChannelMemberParams,
    ): Promise<void> {
        await this.requireAccount(uin).client.call("conversations.invite", {
            channel: params.channel_id.string,
            users: params.user_id.string,
        });
    }

    async kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        await this.requireAccount(uin).client.kickChannelMember(
            params.channel_id.string,
            params.user_id.string,
        );
    }

    async getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        const bot = this.requireAccount(uin).client;
        const memberIds = await bot.getChannelMembers(params.channel_id.string);
        return mapWithConcurrency(memberIds, 8, async memberId => {
            const user = await bot.getUserInfo(memberId);
            return {
                channel_id: params.channel_id,
                user_id: this.createId(user.id),
                user_name: slackUserDisplayName(user),
                role: user.is_admin ? "admin" : user.is_owner ? "owner" : "member",
            } satisfies Adapter.ChannelMemberInfo;
        });
    }

    async getChannelMemberInfo(
        uin: string,
        params: Adapter.GetChannelMemberInfoParams,
    ): Promise<Adapter.ChannelMemberInfo> {
        const user = await this.requireAccount(uin).client.getUserInfo(params.user_id.string);
        return {
            channel_id: params.channel_id,
            user_id: this.createId(user.id),
            user_name: slackUserDisplayName(user),
            role: user.is_admin ? "admin" : user.is_owner ? "owner" : "member",
        };
    }
}

async function mapWithConcurrency<T, R>(
    values: readonly T[],
    concurrency: number,
    task: (value: T) => Promise<R>,
): Promise<R[]> {
    const result = new Array<R>(values.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (cursor < values.length) {
            const index = cursor++;
            result[index] = await task(values[index]);
        }
    });
    await Promise.all(workers);
    return result;
}
