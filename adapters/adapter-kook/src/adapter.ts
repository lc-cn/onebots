import { readFile } from "node:fs/promises";
import { Account, AccountStatus, Adapter, AdapterRegistry, BaseApp } from "onebots";
import { createKookAccount } from "./account.js";
import { KookBot } from "./bot.js";
import { kookCapabilities } from "./capabilities.js";
import { buildKookOutboundMessage, projectKookMessageSegments } from "./messages.js";
import { executeKookPlatformAction, KOOK_PLATFORM_ACTIONS } from "./platform-actions.js";
import type {
    KookChannel,
    KookGuild,
    KookListResponse,
    KookMessageView,
    KookUser,
} from "./types.js";

export class KookAdapter extends Adapter<KookBot, "kook"> {
    constructor(app: BaseApp) {
        super(app, "kook", kookCapabilities);
        this.icon = "https://www.kookapp.cn/favicon.ico";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const direct = params.scene_type === "private" || params.scene_type === "direct";
        const result = direct
            ? await bot.sendDirectMessage(
                  params.scene_id.string,
                  buildKookOutboundMessage(params.message),
              )
            : await bot.sendChannelMessage(
                  params.scene_id.string,
                  buildKookOutboundMessage(params.message),
              );
        bot.rememberMessageScene(
            result.msg_id,
            direct ? "direct" : "channel",
            params.scene_id.string,
        );
        return { message_id: this.createId(result.msg_id) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const bot = this.requireBot(uin);
        const id = params.message_id.string;
        const scene = this.messageScene(bot, id, params.scene_type);
        await bot.callApi(`/v3/${scene === "direct" ? "direct-message" : "message"}/delete`, {
            method: "POST",
            body: { msg_id: id },
        });
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const bot = this.requireBot(uin);
        const id = params.message_id.string;
        const scene = this.messageScene(bot, id, params.scene_type);
        const context = bot.getMessageContext(id);
        const message =
            scene === "direct"
                ? await this.getDirectMessage(
                      bot,
                      id,
                      context?.chatCode,
                      params.scene_id?.string || context?.targetId,
                  )
                : await bot.callApi<KookMessageView>("/v3/message/view", {
                      query: { msg_id: id },
                  });
        const authorId = message.author?.id || message.author_id || context?.targetId || "";
        bot.rememberMessageScene(
            id,
            scene,
            params.scene_id?.string || context?.targetId,
            context?.chatCode,
        );
        const sceneId =
            params.scene_id?.string ||
            (scene === "direct"
                ? context?.targetId || authorId
                : message.channel_id || context?.targetId || "");
        return {
            message_id: this.createId(message.id || id),
            time: normaliseTimestamp(message.create_at),
            sender: {
                scene_type: scene === "direct" ? "private" : "channel",
                sender_id: this.createId(authorId),
                scene_id: this.createId(sceneId),
                sender_name: message.author?.nickname || message.author?.username || authorId,
                scene_name: "",
            },
            message: projectKookMessageSegments(message.type, message.content),
        };
    }

    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const bot = this.requireBot(uin);
        const id = params.message_id.string;
        const scene = this.messageScene(bot, id);
        const message = buildKookOutboundMessage(params.message);
        await bot.callApi(`/v3/${scene === "direct" ? "direct-message" : "message"}/update`, {
            method: "POST",
            body: { msg_id: id, content: message.content, quote: message.quote },
        });
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const bot = this.requireBot(uin);
        const me = bot.getCachedMe() || (await bot.callApi<KookUser>("/v3/user/me"));
        return this.toUserInfo(me);
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const user = await this.requireBot(uin).callApi<KookUser>("/v3/user/view", {
            query: { user_id: params.user_id.string },
        });
        return this.toUserInfo(user);
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        return (await this.listAll<KookGuild>(this.requireBot(uin), "/v3/guild/list")).map(
            guild => ({
                group_id: this.createId(guild.id),
                group_name: guild.name,
            }),
        );
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const guild = await this.guild(uin, params.group_id.string);
        return { group_id: this.createId(guild.id), group_name: guild.name };
    }

    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        await this.requireBot(uin).callApi("/v3/guild/leave", {
            method: "POST",
            body: { guild_id: params.group_id.string },
        });
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const users = await this.listAll<KookUser>(this.requireBot(uin), "/v3/guild/user-list", {
            guild_id: params.group_id.string,
        });
        return users.map(user => this.toGroupMember(user, params.group_id));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const user = await this.requireBot(uin).callApi<KookUser>("/v3/user/view", {
            query: { user_id: params.user_id.string, guild_id: params.group_id.string },
        });
        return this.toGroupMember(user, params.group_id);
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        await this.requireBot(uin).callApi("/v3/guild/kickout", {
            method: "POST",
            body: { guild_id: params.group_id.string, target_id: params.user_id.string },
        });
    }

    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        await this.requireBot(uin).callApi("/v3/guild/nickname", {
            method: "POST",
            body: {
                guild_id: params.group_id.string,
                user_id: params.user_id.string,
                nickname: params.card,
            },
        });
    }

    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        return (await this.listAll<KookGuild>(this.requireBot(uin), "/v3/guild/list")).map(
            guild => ({
                guild_id: this.createId(guild.id),
                guild_name: guild.name,
            }),
        );
    }

    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const guild = await this.guild(uin, params.guild_id.string);
        return { guild_id: this.createId(guild.id), guild_name: guild.name };
    }

    async getGuildMemberList(
        uin: string,
        params: Adapter.GetGuildMemberListParams,
    ): Promise<Adapter.GuildMemberInfo[]> {
        const users = await this.listAll<KookUser>(this.requireBot(uin), "/v3/guild/user-list", {
            guild_id: params.guild_id.string,
        });
        return users.map(user => ({
            guild_id: params.guild_id,
            user_id: this.createId(user.id),
            user_name: user.username,
            nickname: user.nickname,
            role: user.roles?.join(","),
        }));
    }

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const user = await this.requireBot(uin).callApi<KookUser>("/v3/user/view", {
            query: { user_id: params.user_id.string, guild_id: params.guild_id.string },
        });
        return {
            guild_id: params.guild_id,
            user_id: this.createId(user.id),
            user_name: user.username,
            nickname: user.nickname,
            role: user.roles?.join(","),
        };
    }

    async getChannelList(
        uin: string,
        params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        if (!params?.guild_id) throw new Error("KOOK get_channel_list 必须提供 guild_id");
        const channels = await this.listAll<KookChannel>(this.requireBot(uin), "/v3/channel/list", {
            guild_id: params.guild_id.string,
        });
        return channels.map(channel => this.toChannelInfo(channel));
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const channel = await this.requireBot(uin).callApi<KookChannel>("/v3/channel/view", {
            query: { target_id: params.channel_id.string },
        });
        return this.toChannelInfo(channel);
    }

    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const channel = await this.requireBot(uin).callApi<KookChannel>("/v3/channel/create", {
            method: "POST",
            body: {
                guild_id: params.guild_id.string,
                name: params.channel_name,
                type: params.channel_type || 1,
                parent_id: params.parent_id?.string,
            },
        });
        return this.toChannelInfo(channel);
    }

    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        await this.requireBot(uin).callApi("/v3/channel/update", {
            method: "POST",
            body: {
                channel_id: params.channel_id.string,
                name: params.channel_name,
                parent_id: params.parent_id?.string,
            },
        });
    }

    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        await this.requireBot(uin).callApi("/v3/channel/delete", {
            method: "POST",
            body: { channel_id: params.channel_id.string },
        });
    }

    async getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        const response = await this.requireBot(uin).callApi<KookListResponse<KookUser>>(
            "/v3/channel/user-list",
            { query: { channel_id: params.channel_id.string } },
        );
        return response.items.map(user => ({
            channel_id: params.channel_id,
            user_id: this.createId(user.id),
            user_name: user.username,
            role: "member",
        }));
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!KOOK_PLATFORM_ACTIONS.has(action))
            return super.executePlatformAction(uin, action, params);
        return executeKookPlatformAction(this.requireBot(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return KOOK_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        const version = await readPackageVersion(new URL("../package.json", import.meta.url));
        return { app_name: "onebots KOOK Adapter", app_version: version, impl: "kook", version };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const online = this.getAccount(uin)?.status === AccountStatus.Online;
        return { online, good: online };
    }

    createAccount(config: Account.Config<"kook">): Account<"kook", KookBot> {
        return createKookAccount(this, config);
    }

    private requireBot(uin: string): KookBot {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return account.client;
    }

    private messageScene(
        bot: KookBot,
        messageId: string,
        scene?: "private" | "group" | "channel" | "direct",
    ): "channel" | "direct" {
        if (scene) return scene === "private" || scene === "direct" ? "direct" : "channel";
        const known = bot.getMessageScene(messageId);
        if (!known) {
            throw new Error("KOOK 消息场景未知；请提供 scene_type，或先接收/发送该消息");
        }
        return known;
    }

    private async guild(uin: string, guildId: string): Promise<KookGuild> {
        return this.requireBot(uin).callApi("/v3/guild/view", { query: { guild_id: guildId } });
    }

    private async getDirectMessage(
        bot: KookBot,
        messageId: string,
        chatCode?: string,
        targetId?: string,
    ): Promise<KookMessageView> {
        if (chatCode) {
            return bot.callApi("/v3/direct-message/view", {
                query: { chat_code: chatCode, msg_id: messageId },
            });
        }
        if (!targetId) {
            throw new Error("KOOK 私聊消息详情需要 scene_id（目标用户）或已知 chat_code");
        }
        const response = await bot.callApi<KookListResponse<KookMessageView>>(
            "/v3/direct-message/list",
            { query: { target_id: targetId, msg_id: messageId, flag: "around", page_size: 50 } },
        );
        const message = response.items.find(item => item.id === messageId);
        if (!message) throw new Error(`KOOK 私聊消息不存在: ${messageId}`);
        return message;
    }

    private async listAll<T>(
        bot: KookBot,
        path: string,
        query: Record<string, string | number | boolean | undefined> = {},
    ): Promise<T[]> {
        const items: T[] = [];
        let page = 1;
        do {
            const response = await bot.callApi<KookListResponse<T>>(path, {
                query: { ...query, page, page_size: 100 },
            });
            items.push(...response.items);
            if (!response.meta?.page_total || page >= response.meta.page_total) break;
            page++;
        } while (true);
        return items;
    }

    private toUserInfo(user: KookUser): Adapter.UserInfo {
        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            user_displayname: user.nickname || user.username,
            avatar: user.avatar,
        };
    }

    private toGroupMember(
        user: KookUser,
        groupId: Adapter.GroupMemberInfo["group_id"],
    ): Adapter.GroupMemberInfo {
        return {
            group_id: groupId,
            user_id: this.createId(user.id),
            user_name: user.username,
            card: user.nickname,
            role: "member",
        };
    }

    private toChannelInfo(channel: KookChannel): Adapter.ChannelInfo {
        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        };
    }
}

async function readPackageVersion(url: URL): Promise<string> {
    const metadata: unknown = JSON.parse(await readFile(url, "utf8"));
    if (!metadata || typeof metadata !== "object" || !("version" in metadata)) {
        throw new TypeError(`包元数据缺少 version: ${url.pathname}`);
    }
    return String(metadata.version);
}

function normaliseTimestamp(value: number): number {
    return value < 10_000_000_000 ? value * 1_000 : value;
}

AdapterRegistry.register("kook", KookAdapter, {
    name: "kook",
    displayName: "KOOK 官方机器人",
    description: "KOOK 官方机器人适配器，支持 Gateway、Webhook 与完整开放平台扩展动作",
    icon: "https://www.kookapp.cn/favicon.ico",
    homepage: "https://developer.kookapp.cn/",
    author: "凉菜",
    capabilities: kookCapabilities,
});
