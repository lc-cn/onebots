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

    it("所有新增动作进入同一个不可变能力集合", () => {
        expect(TELEGRAM_PLATFORM_ACTIONS.has("create_forum_topic")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("set_bot_commands")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("answer_inline_query")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("set_chat_permissions")).toBe(true);
    });

    it("在 API 调用前执行 Telegram 官方集合上限", async () => {
        const sendPoll = vi.fn();
        await expect(
            executeTelegramPlatformAction(
                botWithApi({ sendPoll } as unknown as Bot["api"]),
                "send_poll",
                { chat_id: 1, question: "Q", options: ["only"] },
            ),
        ).rejects.toMatchObject({ code: "TELEGRAM_PARAM_INVALID" });
        expect(sendPoll).not.toHaveBeenCalled();
    });
});

function botWithApi(api: Bot["api"]): TelegramBot {
    return {
        getBot: () => ({ api }),
        callApi: async (_method: string, task: () => Promise<unknown>) => task(),
    } as unknown as TelegramBot;
}
