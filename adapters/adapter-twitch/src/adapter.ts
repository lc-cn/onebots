import { randomUUID } from "node:crypto";
import {
    Account,
    AccountStatus,
    Adapter,
    BaseApp,
    readPackageVersion,
    type AdapterCapabilityManifest,
    type CommonTypes,
} from "onebots";
import { normalizeTwitchConfig } from "./adapter-support.js";
import { describeTwitchCapabilities, twitchCapabilities } from "./capabilities.js";
import { TwitchClient } from "./client.js";
import { TwitchError } from "./errors.js";
import { projectTwitchEvent } from "./events.js";
import { TwitchHttpHost } from "./http-host.js";
import { compileTwitchMessage } from "./messages.js";
import { executeTwitchPlatformAction, TWITCH_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { TwitchChannel, TwitchChatter, TwitchDelivery, TwitchUser } from "./types.js";

export class TwitchAdapter extends Adapter<TwitchClient, "twitch"> {
    private readonly httpHost: TwitchHttpHost;

    constructor(app: BaseApp) {
        super(app, "twitch", twitchCapabilities);
        this.icon = "https://assets.twitch.tv/assets/favicon-32-e29e246c157142c94346.png";
        this.httpHost = new TwitchHttpHost(app, accountId => this.getAccount(accountId)?.client);
    }

    describeCapabilities(uin?: string): AdapterCapabilityManifest {
        const client = uin ? this.getAccount(uin)?.client : undefined;
        return client
            ? describeTwitchCapabilities(client.config, client.tokenInfo?.scopes)
            : twitchCapabilities;
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const client = this.requireClient(uin);
        const compiled = compileTwitchMessage(params.message);
        if (params.scene_type === "direct" || params.scene_type === "private") {
            await client.sendWhisper(params.scene_id.string, compiled.text);
            return { message_id: this.createId(`whisper:${randomUUID()}`) };
        }
        this.assertChannelScene(params.scene_type);
        const result = await client.sendChatMessage(params.scene_id.string, compiled.text, {
            replyParentMessageId: compiled.replyParentMessageId,
        });
        return { message_id: this.createId(result.message_id) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const client = this.requireClient(uin);
        await client.deleteChatMessage(
            params.scene_id?.string || client.config.broadcaster_user_id,
            this.moderatorId(client),
            params.message_id.string,
        );
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        if (!client.me)
            throw new TwitchError("Twitch Client 尚未就绪", { code: "TWITCH_NOT_STARTED" });
        return this.userInfo(client.me);
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const user = (await this.requireClient(uin).getUsers({ ids: [params.user_id.string] }))[0];
        if (!user)
            throw new TwitchError(`Twitch 用户 ${params.user_id.string} 不存在`, {
                code: "TWITCH_USER_NOT_FOUND",
                status: 404,
            });
        return this.userInfo(user);
    }

    async createUserChannel(
        uin: string,
        params: Adapter.CreateUserChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const user = (await this.requireClient(uin).getUsers({ ids: [params.user_id.string] }))[0];
        if (!user)
            throw new TwitchError(`Twitch 用户 ${params.user_id.string} 不存在`, {
                code: "TWITCH_USER_NOT_FOUND",
                status: 404,
            });
        return { channel_id: this.createId(user.id), channel_name: user.display_name };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const client = this.requireClient(uin);
        const channel = (await client.getChannels([client.config.broadcaster_user_id]))[0];
        return channel ? [this.groupInfo(channel)] : [];
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        return this.groupInfo(
            await this.requireChannel(this.requireClient(uin), params.group_id.string),
        );
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const client = this.requireClient(uin);
        const chatters = await client.getAllChatters(
            params.group_id.string,
            this.moderatorId(client),
        );
        return chatters.map(chatter => this.groupMember(params.group_id.string, chatter));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const client = this.requireClient(uin);
        const chatter = (
            await client.getAllChatters(params.group_id.string, this.moderatorId(client))
        ).find(item => item.user_id === params.user_id.string);
        if (!chatter)
            throw new TwitchError(`Twitch channel 中不存在用户 ${params.user_id.string}`, {
                code: "TWITCH_CHATTER_NOT_FOUND",
                status: 404,
            });
        return this.groupMember(params.group_id.string, chatter);
    }

    async muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> {
        const client = this.requireClient(uin);
        await client.banUser(
            params.group_id.string,
            this.moderatorId(client),
            params.user_id.string,
            params.duration > 0 ? { duration: params.duration } : {},
        );
    }

    async setGroupAdmin(uin: string, params: Adapter.SetGroupAdminParams): Promise<void> {
        const client = this.requireClient(uin);
        await client.call(params.enable ? "POST" : "DELETE", "moderation/moderators", {
            query: {
                broadcaster_id: params.group_id.string,
                user_id: params.user_id.string,
            },
        });
    }

    async sendGroupAnnouncement(
        uin: string,
        params: Adapter.SendGroupAnnouncementParams,
    ): Promise<void> {
        const client = this.requireClient(uin);
        await client.sendAnnouncement(
            params.group_id.string,
            this.moderatorId(client),
            params.content,
        );
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const channel = await this.requireChannel(
            this.requireClient(uin),
            params.channel_id.string,
        );
        return this.channelInfo(channel);
    }

    async getChannelList(uin: string): Promise<Adapter.ChannelInfo[]> {
        const client = this.requireClient(uin);
        const channel = (await client.getChannels([client.config.broadcaster_user_id]))[0];
        return channel ? [this.channelInfo(channel)] : [];
    }

    async canSendImage(): Promise<boolean> {
        return false;
    }

    async canSendRecord(): Promise<boolean> {
        return false;
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return TWITCH_PLATFORM_ACTIONS.has(action)
            ? executeTwitchPlatformAction(this.requireClient(uin), action, params)
            : super.executePlatformAction(uin, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return TWITCH_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Twitch Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Twitch Helix API + EventSub",
            version: "Helix / EventSub",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        if (!account) return { good: false };
        const online = account.status === AccountStatus.Online;
        const transportGood =
            account.client.receiveMode !== "websocket" || account.client.isConnected;
        return {
            online,
            good: online && transportGood,
            bots: [
                {
                    self: this.createId(
                        account.client.me?.id || account.client.config.broadcaster_user_id,
                    ),
                    online,
                },
            ],
        };
    }

    createAccount(config: Account.Config<"twitch">): Account<"twitch", TwitchClient> {
        const client = new TwitchClient(normalizeTwitchConfig(config), {
            reportError: error => this.logger.error("Twitch Client 异常", error),
        });
        const account = new Account<"twitch", TwitchClient>(this, client, config);
        client.on("event", (delivery: TwitchDelivery) =>
            account.dispatchManyAwaited(
                projectTwitchEvent(delivery, {
                    botId: this.createId(
                        client.me?.id ||
                            client.config.bot_user_id ||
                            client.config.broadcaster_user_id,
                    ),
                    createId: value => this.createId(value),
                }),
            ),
        );
        client.on("error", error => this.logger.error("Twitch 事件管线异常", error));
        this.httpHost.mount(account.account_id, client);
        account.on("start", async (signal: AbortSignal) => {
            try {
                await client.start(signal);
                account.status = AccountStatus.Online;
                account.nickname = client.me?.display_name || account.account_id;
                this.logger.info(`Twitch ${account.account_id} 已就绪（${client.receiveMode}）`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 Twitch ${account.account_id} 失败`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            try {
                await client.stop();
            } finally {
                account.status = AccountStatus.OffLine;
            }
        });
        return account;
    }

    private requireClient(uin: string): TwitchClient {
        const client = this.getAccount(uin)?.client;
        if (!client)
            throw new TwitchError(`Twitch 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
                status: 404,
            });
        return client;
    }

    private moderatorId(client: TwitchClient): string {
        return (
            client.config.moderator_user_id || client.me?.id || client.config.broadcaster_user_id
        );
    }

    private assertChannelScene(scene: CommonTypes.Scene): void {
        if (scene !== "channel" && scene !== "group") {
            throw TwitchError.invalid("Twitch 消息目标必须是 channel/group 或 direct/private");
        }
    }

    private async requireChannel(client: TwitchClient, id: string): Promise<TwitchChannel> {
        const channel = (await client.getChannels([id]))[0];
        if (!channel)
            throw new TwitchError(`Twitch channel ${id} 不存在`, {
                code: "TWITCH_CHANNEL_NOT_FOUND",
                status: 404,
            });
        return channel;
    }

    private userInfo(user: TwitchUser): Adapter.UserInfo {
        return {
            user_id: this.createId(user.id),
            user_name: user.login,
            user_displayname: user.display_name,
            avatar: user.profile_image_url,
            bio: user.description,
        };
    }

    private groupInfo(channel: TwitchChannel): Adapter.GroupInfo {
        return {
            group_id: this.createId(channel.broadcaster_id),
            group_name: channel.broadcaster_name,
            description: channel.title,
            remark: channel.game_name,
        };
    }

    private channelInfo(channel: TwitchChannel): Adapter.ChannelInfo {
        return {
            channel_id: this.createId(channel.broadcaster_id),
            channel_name: channel.broadcaster_name,
        };
    }

    private groupMember(groupId: string, chatter: TwitchChatter): Adapter.GroupMemberInfo {
        return {
            group_id: this.createId(groupId),
            user_id: this.createId(chatter.user_id),
            user_name: chatter.user_name,
            card: chatter.user_login,
            role: chatter.user_id === groupId ? "owner" : "member",
        };
    }
}
