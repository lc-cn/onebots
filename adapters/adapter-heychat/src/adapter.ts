import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    type CommonTypes,
} from "onebots";
import { HeychatBot } from "./bot.js";
import { heychatCapabilities } from "./capabilities.js";
import { projectHeychatEvent } from "./events.js";
import { compileHeychatMessage } from "./messages.js";
import { executeHeychatPlatformAction, HEYCHAT_PLATFORM_ACTIONS } from "./platform-actions.js";
import { extractRoomId } from "./utils.js";
import type {
    HeychatChannelInfo,
    HeychatConfig,
    HeychatSendMessageResult,
    HeychatUserInfo,
    HeychatWsEnvelope,
} from "./types.js";

export class HeychatAdapter extends Adapter<HeychatBot, "heychat"> {
    constructor(app: BaseApp) {
        super(app, "heychat", heychatCapabilities);
        this.icon = "https://chat.xiaoheihe.cn/favicon.ico";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const message = compileHeychatMessage(params.message, value => this.toPlatformId(value));
        const sceneId = this.toPlatformId(params.scene_id);
        let result: HeychatSendMessageResult;
        if (params.scene_type === "private" || params.scene_type === "direct") {
            result = await bot.sendPrivateMessage(sceneId, message);
        } else {
            const target = bot.resolveSendTarget(sceneId);
            result = await bot.sendChannelMessage(target.room_id, target.channel_id, message);
        }
        return { message_id: this.createId(result.msg_id) };
    }

    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const bot = this.requireBot(uin);
        const msgId = this.toPlatformId(params.message_id);
        const context = bot.getMessageContext(msgId);
        if (!context) throw new Error("更新频道消息需要已知消息上下文");
        const message = compileHeychatMessage(params.message, value => this.toPlatformId(value));
        await bot.callApi("/chatroom/v2/channel_msg/update", {
            method: "POST",
            body: {
                ...message,
                room_id: context.room_id,
                channel_id: context.channel_id,
                msg_id: msgId,
            },
        });
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const bot = this.requireBot(uin);
        const msgId = this.toPlatformId(params.message_id);
        let context = bot.getMessageContext(msgId);
        if (params.scene_id) {
            const target = bot.resolveSendTarget(this.toPlatformId(params.scene_id));
            context = { room_id: target.room_id, channel_id: target.channel_id };
        }
        if (!context) throw new Error("删除频道消息需要 scene_id 或已知消息上下文");
        await bot.deleteChannelMessage(context.room_id, context.channel_id, msgId);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.requireAccount(uin);
        const botId = account.client.getBotId();
        return {
            user_id: this.createId(botId ?? account.config.account_id),
            user_name: account.nickname || account.config.account_id,
            avatar: account.avatar || this.icon,
        };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        return (await this.requireBot(uin).listJoinedRooms()).map(room => ({
            group_id: this.createId(room.room_id),
            group_name: room.room_name || room.room_id,
            member_count: room.member_count ?? room.user_count,
        }));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const roomId = extractRoomId(this.toPlatformId(params.group_id));
        const room = await this.requireBot(uin).getRoomInfo(roomId);
        return {
            group_id: this.createId(room.room_id),
            group_name: room.room_name || room.room_id,
            member_count: room.member_count ?? room.user_count,
        };
    }

    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        await this.requireBot(uin).callApi("/chatroom/v2/room/leave", {
            method: "POST",
            body: { room_id: extractRoomId(this.toPlatformId(params.group_id)) },
        });
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const bot = this.requireBot(uin);
        const roomId = extractRoomId(this.toPlatformId(params.group_id));
        const users: HeychatUserInfo[] = [];
        for (let offset = 0; ; offset += 50) {
            const page = await bot.listRoomUsers(roomId, undefined, offset, 50);
            const values = page.room_info?.user_info || [];
            users.push(...values);
            const total = page.room_info?.user_count ?? users.length;
            if (!values.length || users.length >= total) break;
        }
        return users.map(user => this.toGroupMember(roomId, user));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const roomId = extractRoomId(this.toPlatformId(params.group_id));
        const userId = this.toPlatformId(params.user_id);
        const page = await this.requireBot(uin).listRoomUsers(roomId, userId);
        const user = page.room_info?.user_info?.find(value => String(value.user_id) === userId);
        if (!user) throw new Error(`房间 ${roomId} 中未找到成员 ${userId}`);
        return this.toGroupMember(roomId, user);
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        await this.requireBot(uin).callApi("/chatroom/v2/room/kick_out", {
            method: "POST",
            body: {
                room_id: extractRoomId(this.toPlatformId(params.group_id)),
                to_user_id: this.numericId(params.user_id),
            },
        });
    }

    async muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> {
        await this.requireBot(uin).callApi("/chatroom/v2/room/ban", {
            method: "POST",
            body: {
                room_id: extractRoomId(this.toPlatformId(params.group_id)),
                to_user_id: this.numericId(params.user_id),
                duration: Math.max(0, Math.floor(params.duration)),
                reason: "OneBots API",
            },
        });
    }

    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        await this.requireBot(uin).callApi("/chatroom/v2/room/nickname", {
            method: "POST",
            body: {
                room_id: extractRoomId(this.toPlatformId(params.group_id)),
                to_user_id: this.numericId(params.user_id),
                nickname: params.card,
            },
        });
    }

    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        return (await this.requireBot(uin).listJoinedRooms()).map(room => ({
            guild_id: this.createId(room.room_id),
            guild_name: room.room_name || room.room_id,
        }));
    }

    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const roomId = extractRoomId(this.toPlatformId(params.guild_id));
        const room = await this.requireBot(uin).getRoomInfo(roomId);
        return {
            guild_id: this.createId(room.room_id),
            guild_name: room.room_name || room.room_id,
        };
    }

    async getGuildMemberList(
        uin: string,
        params: Adapter.GetGuildMemberListParams,
    ): Promise<Adapter.GuildMemberInfo[]> {
        const groupId = params.guild_id;
        const members = await this.getGroupMemberList(uin, { group_id: groupId });
        return members.map(member => ({
            guild_id: groupId,
            user_id: member.user_id,
            user_name: member.user_name,
            nickname: member.card,
            role: member.role,
        }));
    }

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const member = await this.getGroupMemberInfo(uin, {
            group_id: params.guild_id,
            user_id: params.user_id,
        });
        return {
            guild_id: params.guild_id,
            user_id: member.user_id,
            user_name: member.user_name,
            nickname: member.card,
            role: member.role,
        };
    }

    async getChannelList(
        uin: string,
        params: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        const roomId = extractRoomId(this.toPlatformId(params.guild_id));
        const view = await this.requireBot(uin).getRoomView(roomId);
        return this.flattenChannels(view.channels || []).map(channel =>
            this.toChannelInfo(roomId, channel),
        );
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const bot = this.requireBot(uin);
        const channelValue = this.toPlatformId(params.channel_id);
        const target = params.guild_id
            ? {
                  room_id: extractRoomId(this.toPlatformId(params.guild_id)),
                  channel_id: channelValue.includes(":")
                      ? channelValue.split(":", 2)[1]
                      : channelValue,
              }
            : bot.resolveSendTarget(channelValue);
        const view = await bot.getRoomView(target.room_id);
        const channel = this.flattenChannels(view.channels || []).find(
            value => value.channel_id === target.channel_id,
        );
        if (!channel) throw new Error(`房间 ${target.room_id} 中未找到频道 ${target.channel_id}`);
        return this.toChannelInfo(target.room_id, channel);
    }

    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const account = this.requireAccount(uin);
        const roomId = extractRoomId(this.toPlatformId(params.guild_id));
        const channelType = params.channel_type ?? 1;
        const result = await account.client.callApi<{ channel_id?: string }>(
            "/chatroom/v3/channel/create",
            {
                method: "POST",
                body: {
                    room_id: roomId,
                    channel_name: params.channel_name,
                    channel_type: channelType,
                    api_type: account.config.voice_api_type || "trtc",
                    ...(params.parent_id ? { parent_id: this.toPlatformId(params.parent_id) } : {}),
                },
            },
        );
        if (!result.channel_id) throw new Error("创建频道接口未返回 channel_id");
        account.client.rememberChannel({
            room_id: roomId,
            channel_id: result.channel_id,
            channel_name: params.channel_name,
            channel_type: channelType,
        });
        return {
            channel_id: this.createId(`${roomId}:${result.channel_id}`),
            channel_name: params.channel_name,
            channel_type: channelType,
            ...(params.parent_id ? { parent_id: params.parent_id } : {}),
        };
    }

    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        if (params.parent_id) {
            throw new Error("黑盒语音官方 API 未提供移动现有频道到其他分组的稳定接口");
        }
        if (!params.channel_name) return;
        const bot = this.requireBot(uin);
        const target = bot.resolveSendTarget(this.toPlatformId(params.channel_id));
        const current = await this.getChannelInfo(uin, {
            channel_id: params.channel_id,
            guild_id: this.createId(target.room_id),
        });
        await bot.callApi("/chatroom/v2/channel/edit", {
            method: "POST",
            body: {
                room_id: target.room_id,
                channel_id: target.channel_id,
                channel_name: params.channel_name,
                channel_type: current.channel_type ?? 1,
            },
        });
    }

    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        const bot = this.requireBot(uin);
        const target = bot.resolveSendTarget(this.toPlatformId(params.channel_id));
        await bot.callApi("/chatroom/v2/channel/delete", {
            method: "POST",
            body: { room_id: target.room_id, channel_id: target.channel_id },
        });
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return false;
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots",
            impl: "@onebots/adapter-heychat",
            version: "黑盒语音官方机器人 API",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.requireAccount(uin);
        const online = account.client.isConnected();
        return {
            online,
            good: online,
            bots: [{ self: this.createId(account.config.account_id), online }],
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!HEYCHAT_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeHeychatPlatformAction(this.requireBot(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return HEYCHAT_PLATFORM_ACTIONS.has(action);
    }

    createAccount(config: Account.Config<"heychat">): Account<"heychat", HeychatBot> {
        const bot = new HeychatBot(config);
        const account = new Account<"heychat", HeychatBot>(this, bot, config);

        bot.on("ready", () => {
            account.status = AccountStatus.Online;
            this.logger.info(`黑盒语音 Bot ${config.account_id} 已连接`);
        });
        bot.on("disconnected", details => {
            account.status = AccountStatus.Pending;
            this.logger.warn(`黑盒语音 Bot ${config.account_id} 连接中断`, details);
        });
        bot.on("reconnecting", ({ attempt, delay }) => {
            this.logger.info(
                `黑盒语音 Bot ${config.account_id} 将在 ${delay}ms 后进行第 ${attempt} 次重连`,
            );
        });
        bot.on("error", error => {
            this.logger.error(`黑盒语音 Bot ${config.account_id} 错误:`, error);
        });
        bot.on("stopped", () => {
            account.status = AccountStatus.OffLine;
        });
        bot.on("event", (envelope: HeychatWsEnvelope) => {
            try {
                const event = projectHeychatEvent(envelope, {
                    accountId: config.account_id,
                    botId: bot.getBotId(),
                    createId: value => this.createId(value),
                    getChannelContext: channelId => bot.getChannelContext(channelId),
                });
                if (!event) {
                    this.logger.warn(`忽略字段不完整的黑盒语音事件 type=${envelope.type}`);
                    return;
                }
                account.dispatch(event);
            } catch (error) {
                this.logger.error(`投影黑盒语音事件 type=${envelope.type} 失败:`, error);
            }
        });
        account.on("start", async () => {
            account.status = AccountStatus.Pending;
            await bot.start();
        });
        account.on("stop", async () => bot.stop());
        return account;
    }

    private requireAccount(uin: string): Account<"heychat", HeychatBot> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到黑盒语音账号 ${uin}`);
        return account;
    }

    private requireBot(uin: string): HeychatBot {
        return this.requireAccount(uin).client;
    }

    private toPlatformId(value: unknown): string {
        if (value && typeof value === "object" && "string" in value) {
            const resolved = this.resolveId(value as CommonTypes.Id);
            return String(resolved.source ?? resolved.string);
        }
        return String(value ?? "");
    }

    private numericId(value: CommonTypes.Id): number {
        const id = Number(this.toPlatformId(value));
        if (!Number.isSafeInteger(id) || id < 0) throw new Error("黑盒语音用户 ID 必须是安全整数");
        return id;
    }

    private toGroupMember(roomId: string, user: HeychatUserInfo): Adapter.GroupMemberInfo {
        return {
            group_id: this.createId(roomId),
            user_id: this.createId(user.user_id),
            user_name: user.nickname || user.username || String(user.user_id),
            card: user.room_nickname,
            role: "member",
        };
    }

    private flattenChannels(channels: HeychatChannelInfo[]): HeychatChannelInfo[] {
        return channels.flatMap(channel => [
            channel,
            ...this.flattenChannels(channel.channel_list || []),
        ]);
    }

    private toChannelInfo(roomId: string, channel: HeychatChannelInfo): Adapter.ChannelInfo {
        return {
            channel_id: this.createId(`${roomId}:${channel.channel_id}`),
            channel_name: channel.channel_name || channel.channel_id,
            channel_type: channel.channel_type,
            ...(channel.parent_id
                ? { parent_id: this.createId(`${roomId}:${channel.parent_id}`) }
                : {}),
        };
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            heychat: HeychatConfig;
        }
    }
}

AdapterRegistry.register("heychat", HeychatAdapter, {
    name: "heychat",
    displayName: "黑盒语音",
    description: "黑盒语音官方机器人适配器，覆盖消息、房间、角色、频道与语音能力",
    icon: "https://chat.xiaoheihe.cn/favicon.ico",
    homepage: "https://bot.xiaoheihe.cn",
    author: "凉菜",
    capabilities: heychatCapabilities,
});
