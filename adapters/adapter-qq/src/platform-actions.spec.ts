import { describe, expect, it, vi } from "vitest";
import type { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import { executeQQPlatformAction } from "./platform-actions.js";

describe("QQ 平台动作", () => {
    it("按官方路径执行频道表态", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        const client = { call } as unknown as QQClient;
        await executeQQPlatformAction(client, "add_reaction", {
            channel_id: "c1",
            message_id: "m1",
            emoji_type: 1,
            emoji_id: "4",
        });
        expect(call).toHaveBeenCalledWith({
            method: "PUT",
            path: "/channels/c1/messages/m1/reactions/1/4",
        });
    });

    it("通用入口拒绝绝对 URL", async () => {
        const call = vi.fn().mockRejectedValue(new QQApiError("非法路径"));
        const client = { call } as unknown as QQClient;
        await expect(
            executeQQPlatformAction(client, "qq_call", {
                method: "GET",
                path: "https://evil.example",
            }),
        ).rejects.toBeInstanceOf(QQApiError);
    });

    it("通用入口拒绝非标量 query", async () => {
        const client = { call: vi.fn() } as unknown as QQClient;
        await expect(
            executeQQPlatformAction(client, "qq_call", {
                method: "GET",
                path: "/users/@me/guilds",
                query: { cursor: { nested: true } },
            }),
        ).rejects.toMatchObject({ code: "QQ_INVALID_ACTION_PARAMS" });
        expect(client.call).not.toHaveBeenCalled();
    });
});
