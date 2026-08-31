/**
 * Telegram 适配器
 * 继承 Adapter 基类，实现 Telegram 平台功能
 */
import { Account, AdapterRegistry, AccountStatus, readPackageVersion } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { TelegramBot } from "./bot.js";
import type { CommonTypes } from "onebots";
import type { TelegramConfig } from "./types.js";
import { telegramCapabilities } from "./capabilities.js";
import { createTelegramAccount } from "./account.js";
import { executeTelegramPlatformAction, TELEGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";
import { compileTelegramEditableText, sendTelegramMessage } from "./message-sender.js";
import { TelegramError } from "./errors.js";

export class TelegramAdapter extends Adapter<TelegramBot, "telegram"> {
    constructor(app: BaseApp) {
        super(app, "telegram", telegramCapabilities);
        this.icon = "https://telegram.org/favicon.ico";
    }

    /**
     * 发送消息
     */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);
        const messageId = await sendTelegramMessage(bot, sceneId.string, params.message, {
            resolveUserId: value => String(this.resolveId(value).source),
        });
        return {
            message_id: this.createId(messageId),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const bot = this.requireBot(uin);
        const msgId = requireTelegramInteger(
            this.coerceId(params.message_id as CommonTypes.Id | string | number).string,
            "message_id",
        );
        const chatId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : "";

        if (!chatId) return this.unsupported("delete_message", "context_missing");
        await bot.deleteMessage(chatId, msgId);
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const bot = this.requireBot(uin);
        const msgId = requireTelegramInteger(
            this.coerceId(params.message_id as CommonTypes.Id | string | number).string,
            "message_id",
        );
        const rawScene = (
            params as Adapter.UpdateMessageParams & { scene_id?: CommonTypes.Id | string | number }
        ).scene_id;
        const chatId =
            rawScene != null
                ? this.coerceId(rawScene as CommonTypes.Id | string | number).string
                : "";

        const text = compileTelegramEditableText(params.message, {
            resolveUserId: value => String(this.resolveId(value).source),
        });

        if (!chatId) return this.unsupported("update_message", "context_missing");
        await bot.editMessageText(chatId, msgId, text);
    }

    /**
     * 获取机器人自身信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const bot = this.requireBot(uin);
        const me = await bot.getMe();

        return {
            user_id: this.createId(me.id.toString()),
            user_name: me.username || "",
            user_displayname: me.first_name || "",
            avatar: undefined,
        };
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const bot = this.requireBot(uin);
        const chatId = params.group_id.string;
        const chat = await bot.getChat(chatId);

        return {
            group_id: this.createId(chat.id.toString()),
            group_name: chat.title || chat.username || "",
        };
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const bot = this.requireBot(uin);
        await bot.leaveChat(params.group_id.string);
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const bot = this.requireBot(uin);
        const chatId = params.group_id.string;
        const userId = requireTelegramInteger(params.user_id.string, "user_id");
        const member = await bot.getChatMember(chatId, userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(member.user.id.toString()),
            user_name: member.user.username || "",
            card: member.user.first_name || "",
            role:
                member.status === "creator"
                    ? "owner"
                    : member.status === "administrator"
                      ? "admin"
                      : "member",
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const bot = this.requireBot(uin);
        const chatId = params.group_id.string;
        const userId = requireTelegramInteger(params.user_id.string, "user_id");
        await bot.banChatMember(chatId, userId);
        if (!params.reject_add_request) await bot.unbanChatMember(chatId, userId);
    }

    async muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> {
        const bot = this.requireBot(uin);
        const allowed = params.duration <= 0;
        await bot.callApi("restrictChatMember", () =>
            bot.getBot().api.restrictChatMember(
                params.group_id.string,
                requireTelegramInteger(params.user_id.string, "user_id"),
                {
                    can_send_messages: allowed,
                    can_send_audios: allowed,
                    can_send_documents: allowed,
                    can_send_photos: allowed,
                    can_send_videos: allowed,
                    can_send_video_notes: allowed,
                    can_send_voice_notes: allowed,
                    can_send_polls: allowed,
                    can_send_other_messages: allowed,
                    can_add_web_page_previews: allowed,
                    can_change_info: allowed,
                    can_invite_users: allowed,
                    can_pin_messages: allowed,
                    can_manage_topics: allowed,
                },
                params.duration > 0
                    ? { until_date: Math.floor(Date.now() / 1000) + params.duration }
                    : undefined,
            ),
        );
    }

    async setGroupAdmin(uin: string, params: Adapter.SetGroupAdminParams): Promise<void> {
        const enabled = params.enable;
        const bot = this.requireBot(uin);
        await bot.callApi("promoteChatMember", () =>
            bot
                .getBot()
                .api.promoteChatMember(
                    params.group_id.string,
                    requireTelegramInteger(params.user_id.string, "user_id"),
                    {
                        can_manage_chat: enabled,
                        can_delete_messages: enabled,
                        can_manage_video_chats: enabled,
                        can_restrict_members: enabled,
                        can_promote_members: enabled,
                        can_change_info: enabled,
                        can_invite_users: enabled,
                        can_pin_messages: enabled,
                        can_manage_topics: enabled,
                    },
                ),
        );
    }

    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        const bot = this.requireBot(uin);
        await bot.callApi("setChatTitle", () =>
            bot.getBot().api.setChatTitle(params.group_id.string, params.group_name),
        );
    }

    async setGroupSpecialTitle(
        uin: string,
        params: Adapter.SetGroupSpecialTitleParams,
    ): Promise<void> {
        const bot = this.requireBot(uin);
        await bot.callApi("setChatAdministratorCustomTitle", () =>
            bot
                .getBot()
                .api.setChatAdministratorCustomTitle(
                    params.group_id.string,
                    requireTelegramInteger(params.user_id.string, "user_id"),
                    params.special_title,
                ),
        );
    }

    async handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        const flag = params.flag ?? params.request_id?.string;
        const [chatId, userId] = String(flag ?? "").split(":");
        if (
            !chatId ||
            !userId ||
            !Number.isSafeInteger(Number(chatId)) ||
            !Number.isSafeInteger(Number(userId)) ||
            Number(userId) <= 0
        ) {
            throw TelegramError.invalid(
                "Telegram 入群申请 flag 必须为 chat_id:user_id",
                "TELEGRAM_JOIN_REQUEST_FLAG_INVALID",
            );
        }
        const bot = this.requireBot(uin);
        const method = params.approve ? "approveChatJoinRequest" : "declineChatJoinRequest";
        await bot.callApi(method, () =>
            params.approve
                ? bot.getBot().api.approveChatJoinRequest(chatId, Number(userId))
                : bot.getBot().api.declineChatJoinRequest(chatId, Number(userId)),
        );
    }

    async getFile(uin: string, params: Adapter.GetFileParams): Promise<Adapter.FileInfo> {
        const bot = this.requireBot(uin);
        const file = await bot.callApi("getFile", () =>
            bot.getBot().api.getFile(params.file_id.string),
        );
        return {
            file_id: params.file_id,
            file_name: file.file_path ?? params.file_id.string,
            file_size: file.file_size,
        };
    }

    async executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!TELEGRAM_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeTelegramPlatformAction(this.requireBot(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return TELEGRAM_PLATFORM_ACTIONS.has(action);
    }

    private requireBot(uin: string): TelegramBot {
        const account = this.getAccount(uin);
        if (!account) {
            throw TelegramError.resource(
                `Telegram 账号 ${uin} 不存在`,
                "TELEGRAM_ACCOUNT_NOT_FOUND",
                {
                    account_id: uin,
                },
            );
        }
        return account.client;
    }

    /**
     * 获取版本信息
     */
    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        const [appVersion, sdkVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersion(import.meta.resolve("grammy")),
        ]);
        return {
            app_name: "onebots Telegram Adapter",
            app_version: appVersion,
            impl: "telegram",
            version: sdkVersion,
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account
                ? [{ self: this.createId(account.client.getCachedMe()?.id || uin), online }]
                : [],
        };
    }

    createAccount(config: Account.Config<"telegram">): Account<"telegram", TelegramBot> {
        return createTelegramAccount(this, config);
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            telegram: TelegramConfig;
        }
    }
}

AdapterRegistry.register("telegram", TelegramAdapter, {
    name: "telegram",
    displayName: "Telegram官方机器人",
    description: "Telegram官方机器人适配器，支持私聊、群组和频道",
    icon: "https://telegram.org/favicon.ico",
    homepage: "https://telegram.org/",
    author: "凉菜",
    capabilities: telegramCapabilities,
});

function requireTelegramInteger(value: string | number, name: string): number {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw TelegramError.invalid(`Telegram ${name} 必须为安全整数`, "TELEGRAM_ID_INVALID", {
            name,
        });
    }
    return result;
}
