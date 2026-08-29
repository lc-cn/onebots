import { describe, expect, it, vi } from "vitest";
import { executeTelegramPlatformAction } from "./platform-actions.js";

describe("executeTelegramPlatformAction", () => {
    it("将统一参数对象转发给 Telegram Bot API", async () => {
        const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
        const api = { sendPoll } as never;

        await executeTelegramPlatformAction(api, "send_poll", {
            chat_id: -100,
            question: "Q",
            options: ["A", "B"],
        });

        expect(sendPoll).toHaveBeenCalledWith(-100, "Q", ["A", "B"], undefined);
    });

    it("在调用 SDK 前拒绝缺失的结构化参数", async () => {
        await expect(
            executeTelegramPlatformAction({} as never, "forward_message", {
                chat_id: 1,
                from_chat_id: 2,
            }),
        ).rejects.toThrow("message_id 必须为整数");
    });
});
