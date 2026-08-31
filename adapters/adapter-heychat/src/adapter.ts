import {
    Account,
    Adapter,
    AdapterRegistry,
    UnsupportedCapabilityError,
    readPackageVersion,
} from "onebots";
import { HeychatActionBase } from "./action-base.js";
import { HeychatBot } from "./bot.js";
import { heychatCapabilities } from "./capabilities.js";
import { createHeychatAccount } from "./account.js";
import { HeychatApiError } from "./errors.js";
import { normalizeBase64Source, prepareHeychatMediaSegments, uploadHeychatMedia } from "./media.js";
import { compileHeychatMessage } from "./messages.js";
import {
    flattenHeychatChannels,
    projectHeychatChannel,
    projectHeychatGroupMember,
} from "./models.js";
import { executeHeychatPlatformAction, HEYCHAT_PLATFORM_ACTIONS } from "./platform-actions.js";
import { extractRoomId } from "./utils.js";
import type { HeychatSendMessageResult, HeychatUserInfo } from "./types.js";

export class HeychatAdapter extends HeychatActionBase {
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const segments = await prepareHeychatMediaSegments(bot, params.message);
        const message = compileHeychatMessage(segments, value => this.toPlatformId(value));
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
        if (!context) {
            throw HeychatApiError.invalid(
                "更新频道消息需要已知消息上下文",
                "HEYCHAT_MESSAGE_CONTEXT_REQUIRED",
                { message_id: msgId },
            );
        }
        const segments = await prepareHeychatMediaSegments(bot, params.message);
        const message = compileHeychatMessage(segments, value => this.toPlatformId(value));
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
        if (!context) {
            throw HeychatApiError.invalid(
                "删除频道消息需要 scene_id 或已知消息上下文",
                "HEYCHAT_MESSAGE_CONTEXT_REQUIRED",
                { message_id: msgId },
            );
        }
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
        return users.map(user =>
            projectHeychatGroupMember(value => this.createId(value), roomId, user),
        );
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const roomId = extractRoomId(this.toPlatformId(params.group_id));
        const userId = this.toPlatformId(params.user_id);
        const page = await this.requireBot(uin).listRoomUsers(roomId, userId);
        const user = page.room_info?.user_info?.find(value => String(value.user_id) === userId);
        if (!user) {
            throw HeychatApiError.resource(
                `房间 ${roomId} 中未找到成员 ${userId}`,
                "HEYCHAT_MEMBER_NOT_FOUND",
                { room_id: roomId, user_id: userId },
            );
        }
        return projectHeychatGroupMember(value => this.createId(value), roomId, user);
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
        return flattenHeychatChannels(view.channels || []).map(channel =>
            projectHeychatChannel(value => this.createId(value), roomId, channel),
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
        const channel = flattenHeychatChannels(view.channels || []).find(
            value => value.channel_id === target.channel_id,
        );
        if (!channel) {
            throw HeychatApiError.resource(
                `房间 ${target.room_id} 中未找到频道 ${target.channel_id}`,
                "HEYCHAT_CHANNEL_NOT_FOUND",
                target,
            );
        }
        return projectHeychatChannel(value => this.createId(value), target.room_id, channel);
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
        if (!result.channel_id) {
            throw new HeychatApiError("创建频道接口未返回 channel_id", {
                code: "HEYCHAT_INVALID_RESPONSE",
                details: result,
            });
        }
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
            throw new UnsupportedCapabilityError({
                platform: "heychat",
                capability: "update_channel.parent_id",
                reason: "platform_unsupported",
                message: "黑盒语音官方 API 未提供移动现有频道到其他分组的稳定接口",
            });
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

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const sources = [params.url, params.path, params.data].filter(
            (value): value is string => typeof value === "string" && value.length > 0,
        );
        if (sources.length !== 1) {
            throw HeychatApiError.invalid(
                "黑盒语音 upload_file 必须且只能提供 url/path/data 之一",
                "HEYCHAT_MEDIA_SOURCE_REQUIRED",
            );
        }
        const source =
            params.url ||
            params.path ||
            normalizeBase64Source(typeof params.data === "string" ? params.data : "");
        const url = await uploadHeychatMedia(this.requireBot(uin), {
            source,
            filename: params.name,
        });
        return { file_id: this.createId(url), file_name: params.name, url };
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots",
            app_version: await readPackageVersion(import.meta.url),
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
            bots: [
                {
                    self: this.createId(account.client.getBotId() ?? account.config.account_id),
                    online,
                },
            ],
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
        return createHeychatAccount(this, config);
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
