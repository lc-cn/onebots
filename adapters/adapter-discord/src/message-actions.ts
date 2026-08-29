import { Adapter, CommonTypes } from "onebots";
import { DiscordBot, type DiscordMessage } from "./bot.js";
import type { DiscordEmbed } from "./types.js";

/** Discord 消息、用户与好友投影动作。 */
export abstract class DiscordMessageActions extends Adapter<DiscordBot, "discord"> {
    protected abstract buildDiscordMessage(message: CommonTypes.Segment[]): {
        content: string;
        embeds: DiscordEmbed[];
    };

    protected abstract convertMessageToInfo(message: DiscordMessage): Adapter.MessageInfo;

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     * 支持私聊(DM)、群组(Guild)和频道(Channel)消息
     */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        let messageId: string;
        const channelId = sceneId.string;

        // 构建消息内容
        const { content, embeds } = this.buildDiscordMessage(message);

        try {
            let sentMessage: DiscordMessage;

            if (scene_type === "private") {
                // 私信消息 - scene_id 是用户 ID
                sentMessage = await bot.sendDM(channelId, { content, embeds });
            } else if (scene_type === "channel" || scene_type === "group") {
                // 频道消息 - scene_id 是频道 ID
                sentMessage = await bot.sendMessage(channelId, { content, embeds });
            } else {
                throw new Error(`不支持的消息类型: ${scene_type}`);
            }

            messageId = sentMessage.id;
        } catch (error: unknown) {
            this.logger.error(`发送消息失败:`, error);
            throw error;
        }

        return {
            message_id: this.createId(messageId),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const channelId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : "";

        if (!channelId) {
            throw new Error("删除消息需要提供 scene_id (频道ID)");
        }

        await bot.deleteMessage(channelId, messageId);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const channelId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : "";

        if (!channelId) {
            throw new Error("获取消息需要提供 scene_id (频道ID)");
        }

        const message = await bot.getMessage(channelId, messageId);

        return this.convertMessageToInfo(message);
    }

    /**
     * 获取历史消息
     */
    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = this.coerceId(params.scene_id as CommonTypes.Id | string | number).string;
        const limit = params.limit || 50;

        const messages = await bot.getMessageHistory(channelId, limit);

        return [...messages.values()].map(msg => this.convertMessageToInfo(msg));
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const user = bot.getBotUser();

        if (!user) {
            throw new Error("Bot 未就绪");
        }

        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            user_displayname: user.global_name || user.username,
            avatar: user.displayAvatarURL(),
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

        const user = await bot.getUser(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            user_displayname: user.global_name || user.username,
            avatar: user.displayAvatarURL(),
        };
    }

    // ============================================
    // 好友相关方法
    // Discord 没有好友系统，返回空列表
    // ============================================

    /**
     * 获取好友列表
     * Discord 没有传统好友系统，返回空列表
     */
    async getFriendList(
        _uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        return [];
    }

    /**
     * 获取好友信息
     * Discord 没有传统好友系统，返回用户信息
     */
    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;

        const user = await bot.getUser(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.username,
        };
    }
}
