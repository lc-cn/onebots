import { describe, expect, it, vi } from "vitest";
import { executeDiscordPlatformAction } from "./platform-actions.js";

describe("executeDiscordPlatformAction", () => {
    it("通过固定 API 根调用完整 Discord REST API", async () => {
        const request = vi.fn().mockResolvedValue({ id: "1" });
        const bot = { getREST: () => ({ request }) } as never;

        await executeDiscordPlatformAction(bot, "call_discord_api", {
            path: "/applications/1/commands",
            method: "post",
            query: { with_localizations: true },
            body: { name: "ping" },
        });

        expect(request).toHaveBeenCalledWith("/applications/1/commands", {
            method: "POST",
            query: { with_localizations: "true" },
            body: { name: "ping" },
        });
    });

    it("拒绝外部 URL、路径穿越和非标量 query", async () => {
        const bot = { getREST: () => ({ request: vi.fn() }) } as never;
        await expect(
            executeDiscordPlatformAction(bot, "call_discord_api", {
                path: "https://example.com/api",
            }),
        ).rejects.toThrow("安全绝对路径");
        await expect(
            executeDiscordPlatformAction(bot, "call_discord_api", {
                path: "/guilds/../users/@me",
            }),
        ).rejects.toThrow("安全绝对路径");
        await expect(
            executeDiscordPlatformAction(bot, "call_discord_api", {
                path: "/users/@me",
                query: { nested: {} },
            }),
        ).rejects.toThrow("必须为标量");
    });

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

    it("以显式 Guild 动作执行踢出、超时与昵称更新", async () => {
        const request = vi.fn();
        const kickMember = vi.fn().mockResolvedValue(undefined);
        const timeoutMember = vi.fn().mockResolvedValue(undefined);
        const setMemberNickname = vi.fn().mockResolvedValue(undefined);
        const bot = {
            getREST: () => ({ request }),
            kickMember,
            timeoutMember,
            removeTimeout: vi.fn(),
            setMemberNickname,
        } as never;

        await executeDiscordPlatformAction(bot, "kick_guild_member", {
            guild_id: "100",
            user_id: "42",
            reason: "spam",
        });
        await executeDiscordPlatformAction(bot, "timeout_guild_member", {
            guild_id: "100",
            user_id: "42",
            duration: 60,
        });
        await executeDiscordPlatformAction(bot, "set_guild_member_nickname", {
            guild_id: "100",
            user_id: "42",
            nickname: "Alice",
        });

        expect(kickMember).toHaveBeenCalledWith("100", "42", "spam");
        expect(timeoutMember).toHaveBeenCalledWith("100", "42", 60);
        expect(setMemberNickname).toHaveBeenCalledWith("100", "42", "Alice");
    });
});
