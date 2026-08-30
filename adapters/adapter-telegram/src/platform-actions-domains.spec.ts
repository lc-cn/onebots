import type { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { TelegramBot } from "./bot.js";
import { executeTelegramPlatformAction, TELEGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("Telegram 领域动作", () => {
    it("完整保留普通与 custom emoji ReactionType", async () => {
        const setMessageReaction = vi.fn().mockResolvedValue(true);
        await executeTelegramPlatformAction(
            botWithApi({ setMessageReaction } as unknown as Bot["api"]),
            "set_message_reaction",
            {
                chat_id: -100,
                message_id: 7,
                reactions: ["👍", { type: "custom_emoji", custom_emoji_id: "emoji-1" }],
            },
        );
        expect(setMessageReaction).toHaveBeenCalledWith(-100, 7, [
            { type: "emoji", emoji: "👍" },
            { type: "custom_emoji", custom_emoji_id: "emoji-1" },
        ]);
    });

    it("论坛话题动作保持 chat 与 thread 两级地址", async () => {
        const createForumTopic = vi.fn().mockResolvedValue({ message_thread_id: 9 });
        const closeForumTopic = vi.fn().mockResolvedValue(true);
        const bot = botWithApi({ createForumTopic, closeForumTopic } as unknown as Bot["api"]);
        await executeTelegramPlatformAction(bot, "create_forum_topic", {
            chat_id: -100,
            name: "发布",
            options: { icon_color: 0x6fb9f0 },
        });
        await executeTelegramPlatformAction(bot, "close_forum_topic", {
            chat_id: -100,
            message_thread_id: 9,
        });
        expect(createForumTopic).toHaveBeenCalledWith(-100, "发布", {
            icon_color: 0x6fb9f0,
        });
        expect(closeForumTopic).toHaveBeenCalledWith(-100, 9);
    });

    it("Bot 命令和 Callback 应答使用显式稳定入口", async () => {
        const setMyCommands = vi.fn().mockResolvedValue(true);
        const answerCallbackQuery = vi.fn().mockResolvedValue(true);
        const bot = botWithApi({ setMyCommands, answerCallbackQuery } as unknown as Bot["api"]);
        await executeTelegramPlatformAction(bot, "set_bot_commands", {
            commands: [{ command: "help", description: "帮助" }],
        });
        await executeTelegramPlatformAction(bot, "answer_callback_query", {
            callback_query_id: "callback-1",
            options: { text: "完成" },
        });
        expect(setMyCommands).toHaveBeenCalledWith(
            [{ command: "help", description: "帮助" }],
            undefined,
        );
        expect(answerCallbackQuery).toHaveBeenCalledWith("callback-1", { text: "完成" });
    });

    it("使用 Guest Query ID 回复访客消息", async () => {
        const answerGuestQuery = vi.fn().mockResolvedValue({ message_id: 8 });
        await executeTelegramPlatformAction(
            botWithApi({ answerGuestQuery } as unknown as Bot["api"]),
            "answer_guest_query",
            {
                guest_query_id: "guest-1",
                result: { type: "article", id: "reply-1", title: "回复" },
            },
        );
        expect(answerGuestQuery).toHaveBeenCalledWith("guest-1", {
            type: "article",
            id: "reply-1",
            title: "回复",
        });
    });

    it("所有新增动作进入同一个不可变能力集合", () => {
        expect(TELEGRAM_PLATFORM_ACTIONS.has("create_forum_topic")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("set_bot_commands")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("answer_inline_query")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("set_chat_permissions")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("answer_guest_query")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("send_rich_message")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("delete_ephemeral_message")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("answer_chat_join_request_query")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("send_live_photo")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("delete_message_reaction")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("delete_all_message_reactions")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("get_managed_bot_access_settings")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("set_managed_bot_access_settings")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("get_user_personal_chat_messages")).toBe(true);
    });

    it("按 actor 类型调用 Reaction 删除接口并拒绝歧义地址", async () => {
        const deleteMessageReactionUser = vi.fn().mockResolvedValue(true);
        const deleteMessageReactionChat = vi.fn().mockResolvedValue(true);
        const deleteAllMessageReactionsUser = vi.fn().mockResolvedValue(true);
        const deleteAllMessageReactionsChat = vi.fn().mockResolvedValue(true);
        const bot = botWithApi({
            deleteMessageReactionUser,
            deleteMessageReactionChat,
            deleteAllMessageReactionsUser,
            deleteAllMessageReactionsChat,
        } as unknown as Bot["api"]);

        await executeTelegramPlatformAction(bot, "delete_message_reaction", {
            chat_id: -100,
            message_id: 7,
            user_id: 42,
        });
        await executeTelegramPlatformAction(bot, "delete_message_reaction", {
            chat_id: -100,
            message_id: 8,
            actor_chat_id: -200,
        });
        await executeTelegramPlatformAction(bot, "delete_all_message_reactions", {
            chat_id: -100,
            user_id: 42,
        });
        await executeTelegramPlatformAction(bot, "delete_all_message_reactions", {
            chat_id: -100,
            actor_chat_id: -200,
        });

        expect(deleteMessageReactionUser).toHaveBeenCalledWith(-100, 7, 42);
        expect(deleteMessageReactionChat).toHaveBeenCalledWith(-100, 8, -200);
        expect(deleteAllMessageReactionsUser).toHaveBeenCalledWith(-100, 42);
        expect(deleteAllMessageReactionsChat).toHaveBeenCalledWith(-100, -200);
        await expect(
            executeTelegramPlatformAction(bot, "delete_message_reaction", {
                chat_id: -100,
                message_id: 9,
                user_id: 42,
                actor_chat_id: -200,
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
        await expect(
            executeTelegramPlatformAction(bot, "delete_all_message_reactions", {
                chat_id: -100,
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
    });

    it("闭合 Managed Bot 与个人频道消息管理能力", async () => {
        const getManagedBotAccessSettings = vi.fn().mockResolvedValue({});
        const setManagedBotAccessSettings = vi.fn().mockResolvedValue(true);
        const getUserPersonalChatMessages = vi.fn().mockResolvedValue([]);
        const bot = botWithApi({
            getManagedBotAccessSettings,
            setManagedBotAccessSettings,
            getUserPersonalChatMessages,
        } as unknown as Bot["api"]);

        await executeTelegramPlatformAction(bot, "get_managed_bot_access_settings", {
            user_id: 42,
        });
        await executeTelegramPlatformAction(bot, "set_managed_bot_access_settings", {
            user_id: 42,
            is_access_restricted: true,
            added_user_ids: [43, 44],
        });
        await executeTelegramPlatformAction(bot, "get_user_personal_chat_messages", {
            user_id: 42,
            limit: 20,
        });

        expect(getManagedBotAccessSettings).toHaveBeenCalledWith(42);
        expect(setManagedBotAccessSettings).toHaveBeenCalledWith(42, true, {
            added_user_ids: [43, 44],
        });
        expect(getUserPersonalChatMessages).toHaveBeenCalledWith(42, 20);
        await expect(
            executeTelegramPlatformAction(bot, "get_user_personal_chat_messages", {
                user_id: 42,
                limit: 21,
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
        await expect(
            executeTelegramPlatformAction(bot, "set_managed_bot_access_settings", {
                user_id: 42,
                is_access_restricted: false,
                added_user_ids: Array.from({ length: 11 }, (_, index) => index + 1),
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
        expect(setManagedBotAccessSettings).toHaveBeenCalledTimes(1);
    });

    it("发送 Live Photo 双媒体并在调用前拒绝远程 URL", async () => {
        const sendLivePhoto = vi.fn().mockResolvedValue({ message_id: 12 });
        const bot = botWithApi({ sendLivePhoto } as unknown as Bot["api"]);

        await executeTelegramPlatformAction(bot, "send_live_photo", {
            chat_id: -100,
            live_photo: "video-file-id",
            photo: "photo-file-id",
            options: { caption: "live" },
        });
        expect(sendLivePhoto).toHaveBeenCalledWith(-100, "video-file-id", "photo-file-id", {
            caption: "live",
        });
        await expect(
            executeTelegramPlatformAction(bot, "send_live_photo", {
                chat_id: -100,
                live_photo: "https://example.com/live.mp4",
                photo: "photo-file-id",
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_MEDIA_REMOTE_URL_UNSUPPORTED" });
        expect(sendLivePhoto).toHaveBeenCalledTimes(1);
    });

    it("闭合 Rich Message、Ephemeral Message 与入群查询动作", async () => {
        const sendRichMessage = vi.fn().mockResolvedValue({ message_id: 10 });
        const sendRichMessageDraft = vi.fn().mockResolvedValue(true);
        const editEphemeralMessageText = vi.fn().mockResolvedValue(true);
        const answerChatJoinRequestQuery = vi.fn().mockResolvedValue(true);
        const sendChatJoinRequestWebApp = vi.fn().mockResolvedValue(true);
        const bot = botWithApi({
            sendRichMessage,
            sendRichMessageDraft,
            editEphemeralMessageText,
            answerChatJoinRequestQuery,
            sendChatJoinRequestWebApp,
        } as unknown as Bot["api"]);

        await executeTelegramPlatformAction(bot, "send_rich_message", {
            chat_id: -100,
            rich_message: { markdown: "# Hello" },
        });
        await executeTelegramPlatformAction(bot, "send_rich_message_draft", {
            chat_id: 42,
            draft_id: 3,
            rich_message: { markdown: "Typing" },
        });
        await executeTelegramPlatformAction(bot, "edit_ephemeral_message_text", {
            chat_id: -100,
            receiver_user_id: 42,
            ephemeral_message_id: 7,
            rich_message: { markdown: "Updated" },
        });
        await executeTelegramPlatformAction(bot, "answer_chat_join_request_query", {
            chat_join_request_query_id: "query-1",
            result: "queue",
        });
        await executeTelegramPlatformAction(bot, "send_chat_join_request_web_app", {
            chat_join_request_query_id: "query-2",
            web_app_url: "https://bot.example/app",
        });

        expect(sendRichMessage).toHaveBeenCalledWith(-100, { markdown: "# Hello" }, undefined);
        expect(sendRichMessageDraft).toHaveBeenCalledWith(42, 3, { markdown: "Typing" }, undefined);
        expect(editEphemeralMessageText).toHaveBeenCalledWith(
            -100,
            42,
            7,
            {
                markdown: "Updated",
            },
            undefined,
        );
        expect(answerChatJoinRequestQuery).toHaveBeenCalledWith("query-1", "queue");
        expect(sendChatJoinRequestWebApp).toHaveBeenCalledWith(
            "query-2",
            "https://bot.example/app",
        );

        await expect(
            executeTelegramPlatformAction(bot, "answer_chat_join_request_query", {
                chat_join_request_query_id: "query-3",
                result: "accept",
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
        await expect(
            executeTelegramPlatformAction(bot, "send_chat_join_request_web_app", {
                chat_join_request_query_id: "query-4",
                web_app_url: "http://bot.example/app",
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
        expect(answerChatJoinRequestQuery).toHaveBeenCalledTimes(1);
        expect(sendChatJoinRequestWebApp).toHaveBeenCalledTimes(1);
    });

    it("在 API 调用前执行 Telegram 官方集合上限", async () => {
        const sendPoll = vi.fn().mockResolvedValue({ message_id: 11 });
        const bot = botWithApi({ sendPoll } as unknown as Bot["api"]);
        await executeTelegramPlatformAction(bot, "send_poll", {
            chat_id: 1,
            question: "Q",
            options: [{ text: "only", media: { type: "link", url: "https://example.com" } }],
        });
        expect(sendPoll).toHaveBeenCalledWith(
            1,
            "Q",
            [{ text: "only", media: { type: "link", url: "https://example.com" } }],
            undefined,
        );
        await expect(
            executeTelegramPlatformAction(bot, "send_poll", {
                chat_id: 1,
                question: "Q",
                options: [],
            }),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
        expect(sendPoll).toHaveBeenCalledTimes(1);
    });
});

function botWithApi(api: Bot["api"]): TelegramBot {
    return {
        getBot: () => ({ api }),
        callApi: async (_method: string, task: () => Promise<unknown>) => task(),
    } as unknown as TelegramBot;
}
