import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { executeICQQPlatformAction } from "./platform-actions.js";

describe("ICQQ 平台扩展动作", () => {
    it("路由资料动作并保留底层返回值", async () => {
        const setNickname = vi.fn().mockResolvedValue(true);
        const client = { setNickname } as unknown as Client;

        await expect(
            executeICQQPlatformAction(client, "set_nickname", { nickname: "OneBots" }),
        ).resolves.toBe(true);
        expect(setNickname).toHaveBeenCalledWith("OneBots");
    });

    it("在进入 ICQQ 前严格拒绝错误参数", async () => {
        const client = {} as Client;
        await expect(
            executeICQQPlatformAction(client, "set_online_status", { status: "online" }),
        ).rejects.toThrow("status 必须是安全整数");
        await expect(
            executeICQQPlatformAction(client, "send_temp_message", {
                group_id: 1,
                user_id: 2,
                message: "not-an-array",
            }),
        ).rejects.toThrow("message 必须是消息段数组");
    });
});
