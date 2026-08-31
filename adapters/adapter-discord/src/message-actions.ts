import { Adapter, CommonTypes } from "onebots";
import { DiscordBot, type DiscordMessage } from "./bot.js";
import { compileDiscordMessage } from "./messages.js";
import { DiscordError } from "./errors.js";

/** Discord 消息、用户与好友投影动作。 */
export abstract class DiscordMessageActions extends Adapter<DiscordBot, "discord"> {
    protected abstract convertMessageToInfo(message: DiscordMessage): Adapter.MessageInfo;

    /** 统一账号查找边界，避免各动作产生不同形态的空账号错误。 */
    protected requireBot(uin: string): DiscordBot {
        const account = this.getAccount(uin);
        if (!account) {
            throw DiscordError.resource(`Discord 账号 ${uin} 不存在`, "DISCORD_ACCOUNT_NOT_FOUND");
        }
        return account.client;
    }

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
        const bot = this.requireBot(uin);
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        let messageId: string;
        const channelId = sceneId.string;

        // 构建消息内容
        const { body, files } = compileDiscordMessage(message);

        try {
            let sentMessage: DiscordMessage;

            if (scene_type === "private") {
                // 私信消息 - scene_id 是用户 ID
                sentMessage = await bot.sendDM(channelId, body, files);
            } else if (scene_type === "channel" || scene_type === "group") {
                // 频道消息 - scene_id 是频道 ID
                sentMessage = await bot.sendMessage(channelId, body, files);
            } else {
                throw DiscordError.invalid(
                    `Discord 不支持消息场景 ${scene_type}`,
                    "DISCORD_SCENE_UNSUPPORTED",
                );
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
        const bot = this.requireBot(uin);
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const channelId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : "";

        if (!channelId) {
            throw DiscordError.invalid(
                "删除 Discord 消息需要提供 scene_id（频道 ID）",
                "DISCORD_CHANNEL_ID_REQUIRED",
            );
        }

        await bot.deleteMessage(channelId, messageId);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const bot = this.requireBot(uin);
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const channelId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : "";

        if (!channelId) {
            throw DiscordError.invalid(
                "获取 Discord 消息需要提供 scene_id（频道 ID）",
                "DISCORD_CHANNEL_ID_REQUIRED",
            );
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
        const bot = this.requireBot(uin);
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
        const bot = this.requireBot(uin);
        const user = bot.getBotUser();

        if (!user) {
            throw DiscordError.resource("Discord Bot 尚未就绪", "DISCORD_BOT_NOT_READY");
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
        const bot = this.requireBot(uin);
        const userId = params.user_id.string;

        const user = await bot.getUser(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            user_displayname: user.global_name || user.username,
            avatar: user.displayAvatarURL(),
        };
    }
}
