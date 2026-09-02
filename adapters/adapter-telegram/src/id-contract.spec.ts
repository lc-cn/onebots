import type { CommonTypes } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "./adapter.js";

const id = (value: string | number): CommonTypes.Id => ({
    string: String(value),
    number: typeof value === "number" ? value : 90_000_000_000,
    source: value,
});

describe("Telegram 数字 ID 契约", () => {
    it("账号、群和成员 ID 保留 Bot API 的 number 类型", async () => {
        const bot = {
            getMe: vi.fn().mockResolvedValue({ id: 10001, username: "bot", first_name: "Bot" }),
            getChat: vi.fn().mockResolvedValue({ id: -20001, type: "group", title: "Group" }),
            getChatMember: vi.fn().mockResolvedValue({
                status: "member",
                user: { id: 10002, is_bot: false, first_name: "Alice" },
            }),
        };
        const createId = vi.fn(id);
        const adapter = Object.create(TelegramAdapter.prototype) as TelegramAdapter;
        Object.defineProperties(adapter, {
            requireBot: { value: () => bot },
            createId: { value: createId },
        });

        await adapter.getLoginInfo("bot");
        await adapter.getGroupInfo("bot", { group_id: id(-20001) });
        await adapter.getGroupMemberInfo("bot", {
            group_id: id(-20001),
            user_id: id(10002),
        });

        expect(createId).toHaveBeenNthCalledWith(1, 10001);
        expect(createId).toHaveBeenNthCalledWith(2, -20001);
        expect(createId).toHaveBeenNthCalledWith(3, 10002);
    });
});
