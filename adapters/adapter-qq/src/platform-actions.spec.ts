import { describe, expect, it, vi } from "vitest";
import type { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import {
    executeQQPlatformAction,
    QQ_PLATFORM_ACTIONS,
    type QQPlatformAction,
} from "./platform-actions.js";

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

    it("完整注册并跨群、频道服务器和面板领域分派", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        const client = { call } as unknown as QQClient;
        expect(QQ_PLATFORM_ACTIONS.size).toBe(57);

        await executeQQPlatformAction(client, "create_group_join_approval_strategy", {
            strategy: { name: "审核" },
        });
        await executeQQPlatformAction(client, "create_guild_role", {
            guild_id: "g1",
            role: { name: "admin" },
        });
        await executeQQPlatformAction(client, "publish_bot_panel", {
            panel_id: "p1",
            target: { users: ["u1"] },
        });

        expect(call.mock.calls).toEqual([
            [
                {
                    method: "POST",
                    path: "/v2/groups/join_approval_strategy",
                    body: { name: "审核" },
                },
            ],
            [
                {
                    method: "POST",
                    path: "/guilds/g1/roles",
                    body: { name: "admin" },
                },
            ],
            [
                {
                    method: "PUT",
                    path: "/v2/panels/p1/target",
                    body: { users: ["u1"] },
                },
            ],
        ]);
    });

    it("未知动作保留稳定错误码", async () => {
        const client = { call: vi.fn() } as unknown as QQClient;
        const promise = executeQQPlatformAction(client, "missing" as QQPlatformAction, {});
        await expect(promise).rejects.toBeInstanceOf(QQApiError);
        await expect(promise).rejects.toMatchObject({ code: "QQ_UNKNOWN_ACTION" });
    });
});
