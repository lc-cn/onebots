import { describe, expect, it, vi } from "vitest";
import { executeDiscordPlatformAction } from "./platform-actions.js";

describe("executeDiscordPlatformAction", () => {
    it("按 Discord v10 endpoint 创建消息线程", async () => {
        const request = vi.fn().mockResolvedValue({ id: "3" });
        const bot = { getREST: () => ({ request }) } as never;

        await executeDiscordPlatformAction(bot, "create_thread", {
            channel_id: "1",
            message_id: "2",
            thread: { name: "topic" },
        });

        expect(request).toHaveBeenCalledWith("/channels/1/messages/2/threads", {
            method: "POST",
            body: { name: "topic" },
        });
    });

    it("在 REST 调用前校验批量删除数量", async () => {
        await expect(
            executeDiscordPlatformAction(
                { getREST: () => ({ request: vi.fn() }) } as never,
                "bulk_delete_messages",
                { channel_id: "1", message_ids: ["2"] },
            ),
        ).rejects.toThrow("数量必须为 2-100");
    });
});
