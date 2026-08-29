import { describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import { executeTelegramPlatformAction, TELEGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("Telegram 平台扩展动作", () => {
    it("将强类型快捷动作转发给 Telegram Bot API", async () => {
        const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
        const api = { sendPoll } as unknown as Bot["api"];

        await executeTelegramPlatformAction(api, "send_poll", {
            chat_id: -100,
            question: "Q",
            options: ["A", "B"],
        });

        expect(sendPoll).toHaveBeenCalledWith(-100, "Q", ["A", "B"], undefined);
    });

    it("在调用快捷动作前拒绝缺失的结构化参数", async () => {
        await expect(
            executeTelegramPlatformAction({} as unknown as Bot["api"], "forward_message", {
                chat_id: 1,
                from_chat_id: 2,
            }),
        ).rejects.toThrow("message_id 必须为整数");
    });

    it("通过 grammY raw API 调用完整 Bot API", async () => {
        const getMe = vi.fn().mockResolvedValue({ id: 42 });
        const sendDice = vi.fn().mockResolvedValue({ message_id: 7 });
        const api = { raw: { getMe, sendDice } } as unknown as Bot["api"];

        await expect(
            executeTelegramPlatformAction(api, "call_telegram_api", { method: "getMe" }),
        ).resolves.toEqual({ id: 42 });
        expect(getMe).toHaveBeenCalledWith();

        await executeTelegramPlatformAction(api, "call_telegram_api", {
            method: "sendDice",
            params: { chat_id: 123 },
        });
        expect(sendDice).toHaveBeenCalledWith({ chat_id: 123 });
    });

    it("拒绝路径、URL 和非对象参数", async () => {
        const api = { raw: { getMe: vi.fn() } } as unknown as Bot["api"];
        await expect(
            executeTelegramPlatformAction(api, "call_telegram_api", {
                method: "https://api.telegram.org/getMe",
            }),
        ).rejects.toThrow("camelCase");
        await expect(
            executeTelegramPlatformAction(api, "call_telegram_api", {
                method: "getMe",
                params: [],
            }),
        ).rejects.toThrow("params 必须为对象");
    });

    it("将原生入口纳入统一能力集合", () => {
        expect(TELEGRAM_PLATFORM_ACTIONS.has("call_telegram_api")).toBe(true);
    });

    it("以明确动作公开管理员目录与成员总数", async () => {
        const getChatAdministrators = vi.fn().mockResolvedValue([{ status: "creator" }]);
        const getChatMemberCount = vi.fn().mockResolvedValue(42);
        const api = { getChatAdministrators, getChatMemberCount } as unknown as Bot["api"];

        await expect(
            executeTelegramPlatformAction(api, "get_chat_administrators", { chat_id: -100 }),
        ).resolves.toEqual([{ status: "creator" }]);
        await expect(
            executeTelegramPlatformAction(api, "get_chat_member_count", { chat_id: -100 }),
        ).resolves.toBe(42);
    });
});
