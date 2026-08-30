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
            reason: "sync commands",
        });

        expect(request).toHaveBeenCalledWith("/applications/1/commands", {
            method: "POST",
            query: { with_localizations: "true" },
            body: { name: "ping" },
            reason: "sync commands",
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
        await expect(
            executeDiscordPlatformAction(bot, "call_discord_api", {
                path: "/users/@me",
                query: { users: ["1", {}] },
            }),
        ).rejects.toThrow("数组必须只包含标量");
    });

    it("使用重复查询参数搜索 Guild 消息", async () => {
        const request = vi.fn().mockResolvedValue({ total_results: 1, messages: [[]] });
        const bot = { getREST: () => ({ request }) } as never;

        await executeDiscordPlatformAction(bot, "search_guild_messages", {
            guild_id: "100",
            query: {
                content: "release",
                channel_id: ["10", "20"],
                author_type: ["user", "-bot"],
            },
        });

        expect(request).toHaveBeenCalledWith("/guilds/100/messages/search", {
            method: undefined,
            body: undefined,
            query: {
                content: "release",
                channel_id: ["10", "20"],
                author_type: ["user", "-bot"],
            },
        });
    });

    it("以受约束命令发送 Discord Gateway 主动事件", async () => {
        const sendGatewayCommand = vi.fn();
        const bot = { sendGatewayCommand } as never;

        await executeDiscordPlatformAction(bot, "send_gateway_command", {
            command: {
                type: "request_channel_info",
                guild_id: "100",
                fields: ["status", "voice_start_time"],
            },
        });

        expect(sendGatewayCommand).toHaveBeenCalledWith({
            type: "request_channel_info",
            guild_id: "100",
            fields: ["status", "voice_start_time"],
        });
        await expect(
            executeDiscordPlatformAction(bot, "send_gateway_command", {
                command: { type: "request_channel_info", guild_id: "100", fields: ["unknown"] },
            }),
        ).rejects.toThrow("fields 必须包含");
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

    it("提供 Interaction 原始回复与 followup 的显式动作", async () => {
        const editOriginalInteractionResponse = vi.fn().mockResolvedValue({ id: "3" });
        const createFollowupMessage = vi.fn().mockResolvedValue({ id: "4" });
        const request = vi.fn().mockResolvedValue({ id: "5" });
        const bot = {
            getREST: () => ({ request, editOriginalInteractionResponse, createFollowupMessage }),
        } as never;

        await executeDiscordPlatformAction(bot, "edit_original_interaction_response", {
            application_id: "1",
            interaction_token: "token",
            content: { content: "done" },
        });
        await executeDiscordPlatformAction(bot, "create_followup_message", {
            application_id: "1",
            interaction_token: "token",
            content: { content: "next" },
        });
        await executeDiscordPlatformAction(bot, "delete_original_interaction_response", {
            application_id: "1",
            interaction_token: "token/value",
        });
        await executeDiscordPlatformAction(bot, "edit_followup_message", {
            application_id: "1",
            interaction_token: "token/value",
            message_id: "5",
            content: { content: "updated" },
        });

        expect(editOriginalInteractionResponse).toHaveBeenCalledWith("1", "token", {
            content: "done",
        });
        expect(createFollowupMessage).toHaveBeenCalledWith("1", "token", { content: "next" });
        expect(request).toHaveBeenNthCalledWith(1, "/webhooks/1/token%2Fvalue/messages/@original", {
            method: "DELETE",
            body: undefined,
        });
        expect(request).toHaveBeenNthCalledWith(2, "/webhooks/1/token%2Fvalue/messages/5", {
            method: "PATCH",
            body: { content: "updated" },
        });
    });

    it("按官方资源边界管理 Auto Moderation 规则", async () => {
        const request = vi.fn().mockResolvedValue({ id: "7" });
        const bot = { getREST: () => ({ request }) } as never;

        await executeDiscordPlatformAction(bot, "update_auto_moderation_rule", {
            guild_id: "100",
            rule_id: "7",
            rule: { enabled: false },
            reason: "disable noisy rule",
        });

        expect(request).toHaveBeenCalledWith("/guilds/100/auto-moderation/rules/7", {
            method: "PATCH",
            body: { enabled: false },
            query: undefined,
            reason: "disable noisy rule",
        });
    });

    it("管理语音频道状态与完整 Soundboard 生命周期", async () => {
        const request = vi.fn().mockResolvedValue({ sound_id: "8" });
        const bot = { getREST: () => ({ request }) } as never;

        await executeDiscordPlatformAction(bot, "set_voice_channel_status", {
            channel_id: "10",
            status: "发布会直播中",
            reason: "event started",
        });
        await executeDiscordPlatformAction(bot, "send_soundboard_sound", {
            channel_id: "10",
            sound: { sound_id: "8", source_guild_id: "100" },
        });
        await executeDiscordPlatformAction(bot, "list_default_soundboard_sounds", {});
        await executeDiscordPlatformAction(bot, "list_guild_soundboard_sounds", {
            guild_id: "100",
        });
        await executeDiscordPlatformAction(bot, "get_guild_soundboard_sound", {
            guild_id: "100",
            sound_id: "8",
        });
        await executeDiscordPlatformAction(bot, "create_guild_soundboard_sound", {
            guild_id: "100",
            sound: { name: "Build", sound: "data:audio/ogg;base64,T2dnUw==" },
            reason: "new sound",
        });
        await executeDiscordPlatformAction(bot, "update_guild_soundboard_sound", {
            guild_id: "100",
            sound_id: "8",
            sound: { volume: 0.5 },
        });
        await executeDiscordPlatformAction(bot, "delete_guild_soundboard_sound", {
            guild_id: "100",
            sound_id: "8",
        });

        expect(request.mock.calls).toEqual([
            [
                "/channels/10/voice-status",
                { method: "PUT", body: { status: "发布会直播中" }, reason: "event started" },
            ],
            [
                "/channels/10/send-soundboard-sound",
                {
                    method: "POST",
                    body: { sound_id: "8", source_guild_id: "100" },
                    reason: undefined,
                },
            ],
            [
                "/soundboard-default-sounds",
                { method: undefined, body: undefined, reason: undefined },
            ],
            [
                "/guilds/100/soundboard-sounds",
                { method: undefined, body: undefined, reason: undefined },
            ],
            [
                "/guilds/100/soundboard-sounds/8",
                { method: undefined, body: undefined, reason: undefined },
            ],
            [
                "/guilds/100/soundboard-sounds",
                {
                    method: "POST",
                    body: { name: "Build", sound: "data:audio/ogg;base64,T2dnUw==" },
                    reason: "new sound",
                },
            ],
            [
                "/guilds/100/soundboard-sounds/8",
                { method: "PATCH", body: { volume: 0.5 }, reason: undefined },
            ],
            [
                "/guilds/100/soundboard-sounds/8",
                { method: "DELETE", body: undefined, reason: undefined },
            ],
        ]);
    });

    it("在请求前校验语音频道状态长度", async () => {
        const request = vi.fn();
        await expect(
            executeDiscordPlatformAction(
                { getREST: () => ({ request }) } as never,
                "set_voice_channel_status",
                { channel_id: "10", status: "x".repeat(501) },
            ),
        ).rejects.toMatchObject({ code: "DISCORD_ACTION_PARAMS_INVALID" });
        expect(request).not.toHaveBeenCalled();
    });

    it("完整传递 Scheduled Event 查询字段", async () => {
        const request = vi.fn().mockResolvedValue([]);
        const bot = { getREST: () => ({ request }) } as never;

        await executeDiscordPlatformAction(bot, "get_scheduled_event_users", {
            guild_id: "100",
            event_id: "8",
            query: { with_member: true, limit: 25 },
        });

        expect(request).toHaveBeenCalledWith("/guilds/100/scheduled-events/8/users", {
            method: undefined,
            body: undefined,
            query: { with_member: "true", limit: "25" },
            reason: undefined,
        });
    });

    it("创建 Guild Emoji 前校验结构化载荷", async () => {
        const request = vi.fn().mockResolvedValue({ id: "9" });
        const bot = { getREST: () => ({ request }) } as never;

        await executeDiscordPlatformAction(bot, "create_guild_emoji", {
            guild_id: "100",
            emoji: { name: "wave", image: "data:image/png;base64,AA==" },
        });
        expect(request).toHaveBeenCalledWith("/guilds/100/emojis", {
            method: "POST",
            body: { name: "wave", image: "data:image/png;base64,AA==" },
            query: undefined,
            reason: undefined,
        });

        await expect(
            executeDiscordPlatformAction(bot, "create_guild_emoji", {
                guild_id: "100",
                emoji: "invalid",
            }),
        ).rejects.toThrow("emoji 必须为对象");
    });
});
