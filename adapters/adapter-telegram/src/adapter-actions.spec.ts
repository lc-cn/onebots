import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "./adapter.js";

const id = (value: string) => ({ string: value, number: Number(value), source: value });

describe("Telegram canonical 群动作", () => {
    it("踢出成员后按 reject_add_request 决定是否保留封禁", async () => {
        const banChatMember = vi.fn().mockResolvedValue(true);
        const unbanChatMember = vi.fn().mockResolvedValue(true);
        const adapter = Object.create(TelegramAdapter.prototype) as TelegramAdapter;
        Object.defineProperty(adapter, "getAccount", {
            value: () => ({ client: { banChatMember, unbanChatMember } }),
        });

        await adapter.kickGroupMember("bot", {
            group_id: id("-100"),
            user_id: id("42"),
            reject_add_request: false,
        });
        await adapter.kickGroupMember("bot", {
            group_id: id("-100"),
            user_id: id("43"),
            reject_add_request: true,
        });

        expect(banChatMember).toHaveBeenNthCalledWith(1, "-100", 42);
        expect(banChatMember).toHaveBeenNthCalledWith(2, "-100", 43);
        expect(unbanChatMember).toHaveBeenCalledOnce();
        expect(unbanChatMember).toHaveBeenCalledWith("-100", 42);
    });
});
