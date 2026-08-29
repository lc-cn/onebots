/**
 * Slack 适配器
 * 继承 Adapter 基类，实现 Slack 平台功能
 */
import { Account, AdapterRegistry, AccountStatus, readPackageVersion } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { SlackBot } from "./bot.js";
import { type CommonTypes } from "onebots";
import type { SlackConfig, SlackMessage } from "./types.js";
import { slackCapabilities } from "./capabilities.js";
import { createSlackAccount } from "./account.js";
import { executeSlackPlatformAction, SLACK_PLATFORM_ACTIONS } from "./platform-actions.js";
import { compileSlackMessage } from "./messages.js";
import { projectSlackMessageSegments } from "./events.js";

export class SlackAdapter extends Adapter<SlackBot, "slack"> {
    constructor(app: BaseApp) {
        super(app, "slack", slackCapabilities);
        this.icon = "https://slack.com/favicon.ico";
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!SLACK_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return executeSlackPlatformAction(account.client, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return SLACK_PLATFORM_ACTIONS.has(action);
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);
        const { text, options, files } = compileSlackMessage(params.message);
        const channelId = sceneId.string;
        const result = files.length
            ? await bot.sendFiles(channelId, files, text, options)
            : await bot.sendMessage(channelId, text, options);
        if (!result.ts) throw new Error("Slack 发送响应缺少消息时间戳");
        bot.rememberMessage(result.ts, channelId, options.thread_ts);

        return {
            message_id: this.createId(result.ts),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;
        const context = bot.getMessageContext(msgId);
        const channelId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : context?.channel || "";

        if (!channelId) throw new Error("Slack 删除消息需要 scene_id（频道 ID）");
        await bot.deleteMessage(channelId, msgId);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const timestamp = params.message_id.string;
        const context = account.client.getMessageContext(timestamp);
        const channel = params.scene_id?.string || context?.channel;
        if (!channel) throw new Error("Slack 获取消息需要 scene_id（频道 ID）或已知消息上下文");
        const result = await account.client.call("conversations.replies", {
            channel,
            ts: context?.threadTs || timestamp,
            oldest: timestamp,
            latest: timestamp,
            inclusive: true,
            limit: 1,
        });
        const response = result as { messages?: SlackMessage[] };
        const message = response.messages?.find(item => item.ts === timestamp);
        if (!message?.ts) throw new Error(`Slack 消息 ${timestamp} 不存在或当前 token 无权读取`);
        const privateScene = channel.startsWith("D");
        return {
            message_id: this.createId(message.ts),
            time: Math.floor(Number(message.ts)),
            sender: {
                scene_type: privateScene ? "private" : "channel",
                sender_id: this.createId(message.user || ""),
                scene_id: this.createId(channel),
                sender_name: message.user || "",
                scene_name: "",
            },
            message: projectSlackMessageSegments(message),
        };
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;
        const rawScene = (
            params as Adapter.UpdateMessageParams & { scene_id?: CommonTypes.Id | string | number }
        ).scene_id;
        const context = bot.getMessageContext(msgId);
        const channelId =
            rawScene != null
                ? this.coerceId(rawScene as CommonTypes.Id | string | number).string
                : context?.channel || "";

        if (!channelId) throw new Error("Slack 更新消息需要 scene_id（频道 ID）");
        const { text, options, files } = compileSlackMessage(params.message);
        if (files.length) throw new Error("Slack 更新消息不支持新增文件，请使用 call_slack_api");
        if (options.thread_ts) throw new Error("Slack 更新消息不能改变所属线程");
        await bot.updateMessage(channelId, msgId, text, options);
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人自身信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const me = bot.getCachedMe();

        return {
            user_id: this.createId(me?.id || ""),
            user_name: me?.name || "",
            user_displayname: me?.display_name || me?.real_name || me?.name || "",
            avatar: me?.profile?.image_512 || me?.profile?.image_192,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.name || "",
            user_displayname: user.display_name || user.real_name || user.name || "",
            avatar: user.profile?.image_512 || user.profile?.image_192,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（Slack 不支持）
     */
    async getFriendList(
        uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const users = await account.client.getUserList();
        return users
            .filter(user => !user.is_bot)
            .map(user => ({
                user_id: this.createId(user.id),
                user_name: user.name || "",
                remark: user.display_name || user.real_name || user.name || "",
            }));
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.name || "",
            remark: user.display_name || user.real_name || user.name || "",
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（频道列表）
     */
    async getGroupList(
        uin: string,
        _params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channels = await bot.getChannelList();

        return channels.map(channel => ({
            group_id: this.createId(channel.id),
            group_name: channel.name || "",
        }));
    }

    /**
     * 获取群信息（频道信息）
     */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.group_id.string;
        const channel = await bot.getChannelInfo(channelId);

        return {
            group_id: this.createId(channel.id),
            group_name: channel.name || "",
        };
    }

    /**
     * 退出群组（离开频道）
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.leaveChannel(params.group_id.string);
    }

    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const channel = await account.client.createChannel(params.channel_name);
        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
        };
    }

    async kickChannelMember(
        uin: string,
        params: Adapter.KickChannelMemberParams,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.kickChannelMember(params.channel_id.string, params.user_id.string);
    }

    /**
     * 获取群成员列表（频道成员列表）
     */
    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.group_id.string;
        const memberIds = await bot.getChannelMembers(channelId);

        // 获取每个成员的详细信息
        const members: Adapter.GroupMemberInfo[] = [];
        for (const memberId of memberIds) {
            try {
                const user = await bot.getUserInfo(memberId);
                members.push({
                    group_id: params.group_id,
                    user_id: this.createId(user.id),
                    user_name: user.name || "",
                    card: user.display_name || user.real_name || user.name || "",
                    role: user.is_admin ? "admin" : user.is_owner ? "owner" : "member",
                });
            } catch (error) {
                this.logger.error(`[Slack] 获取频道成员 ${memberId} 信息失败:`, error);
            }
        }

        return members;
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(user.id),
            user_name: user.name || "",
            card: user.display_name || user.real_name || user.name || "",
            role: user.is_admin ? "admin" : user.is_owner ? "owner" : "member",
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.kickChannelMember(params.group_id.string, params.user_id.string);
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        const [appVersion, sdkVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersion(import.meta.resolve("@slack/web-api")),
        ]);
        return {
            app_name: "onebots Slack Adapter",
            app_version: appVersion,
            impl: "@slack/web-api",
            version: sdkVersion,
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    createAccount(config: Account.Config<"slack">): Account<"slack", SlackBot> {
        return createSlackAccount(this, config);
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            slack: SlackConfig;
        }
    }
}

AdapterRegistry.register("slack", SlackAdapter, {
    name: "slack",
    displayName: "Slack官方机器人",
    description: "Slack官方机器人适配器，支持频道消息、私聊、应用命令",
    icon: "https://slack.com/favicon.ico",
    homepage: "https://slack.com/",
    author: "凉菜",
    capabilities: slackCapabilities,
});
