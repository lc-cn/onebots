import { describe, expect, test, vi } from "vitest";
import { executeKookPlatformAction } from "./platform-actions.js";

describe("KOOK 平台扩展动作", () => {
    test("命名 GET 动作使用 query", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        await executeKookPlatformAction({ callApi } as never, "list_guild_roles", {
            guild_id: "guild",
            page: 2,
        });
        expect(callApi).toHaveBeenCalledWith("/v3/guild-role/list", {
            query: { guild_id: "guild", page: 2 },
        });
    });

    test("服务器角色动作只接受官方字段并校验范围", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "update_guild_role", {
            guild_id: "guild",
            role_id: 7,
            color: 0xff_ffff,
            hoist: 1,
            mentionable: 0,
            permissions: 2_048,
        });

        expect(callApi).toHaveBeenCalledWith("/v3/guild-role/update", {
            method: "POST",
            body: {
                guild_id: "guild",
                role_id: 7,
                color: 0xff_ffff,
                hoist: 1,
                mentionable: 0,
                permissions: 2_048,
            },
        });
        await expect(
            executeKookPlatformAction(bot, "update_guild_role", {
                guild_id: "guild",
                role_id: 7,
                color: 0x100_0000,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "update_guild_role", {
                guild_id: "guild",
                role_id: 7,
                position: 2,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_UNKNOWN" });
    });

    test("频道权限动作验证目标类型与必填频道", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "update_channel_permission", {
            channel_id: "channel",
            type: "role_id",
            value: "7",
            allow: 2_048,
            deny: 0,
        });
        expect(callApi).toHaveBeenCalledWith("/v3/channel-role/update", {
            method: "POST",
            body: {
                channel_id: "channel",
                type: "role_id",
                value: "7",
                allow: 2_048,
                deny: 0,
            },
        });
        await expect(
            executeKookPlatformAction(bot, "create_channel_permission", {
                channel_id: "channel",
                type: "guild_id",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "sync_channel_permissions", {}),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
    });

    test("补齐消息模板与机器人语音生命周期", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "create_message_template", {
            title: "发布通知",
            content: "{{ data.text }}",
            msgtype: 1,
        });
        await executeKookPlatformAction(bot, "list_joined_voice_channels", { page: 2 });
        await executeKookPlatformAction(bot, "join_voice_channel", {
            channel_id: "voice-1",
            audio_ssrc: "1111",
            rtcp_mux: true,
        });
        await executeKookPlatformAction(bot, "keep_voice_channel_alive", {
            channel_id: "voice-1",
        });

        expect(callApi).toHaveBeenNthCalledWith(1, "/v3/template/create", {
            method: "POST",
            body: { title: "发布通知", content: "{{ data.text }}", msgtype: 1 },
        });
        expect(callApi).toHaveBeenNthCalledWith(2, "/v3/voice/list", {
            query: { page: 2 },
        });
        expect(callApi).toHaveBeenNthCalledWith(3, "/v3/voice/join", {
            method: "POST",
            body: { channel_id: "voice-1", audio_ssrc: "1111", rtcp_mux: true },
        });
        expect(callApi).toHaveBeenNthCalledWith(4, "/v3/voice/keep-alive", {
            method: "POST",
            body: { channel_id: "voice-1" },
        });
    });

    test("通用动作拒绝跳出 /v3 API", async () => {
        await expect(
            executeKookPlatformAction({ callApi: vi.fn() } as never, "call_kook_api", {
                path: "/api/config",
            }),
        ).rejects.toThrow("/v3/");
        await expect(
            executeKookPlatformAction({ callApi: vi.fn() } as never, "call_kook_api", {
                path: "/v3/message/%2e%2e/user/me",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PATH_INVALID" });
    });

    test("创建服务器表情使用 multipart 原生接口", async () => {
        const callMultipart = vi.fn().mockResolvedValue({ id: "emoji" });
        await executeKookPlatformAction({ callMultipart } as never, "create_guild_emoji", {
            guild_id: "guild",
            name: "onebots",
            emoji: "data:image/png;base64,iVBORw0KGgo=",
        });
        expect(callMultipart).toHaveBeenCalledWith(
            "/v3/guild-emoji/create",
            { guild_id: "guild", name: "onebots" },
            expect.objectContaining({ field: "emoji", contentType: "image/png" }),
        );
    });

    test("服务器 Badge 返回可跨协议传输的 Base64", async () => {
        const download = vi.fn().mockResolvedValue({
            data: new Uint8Array([1, 2, 3]),
            contentType: "image/png",
        });
        await expect(
            executeKookPlatformAction({ download } as never, "get_guild_badge", {
                guild_id: "guild",
                style: 2,
            }),
        ).resolves.toEqual({ content_type: "image/png", data: "base64://AQID" });
        expect(download).toHaveBeenCalledWith("/v3/badge/guild", {
            guild_id: "guild",
            style: 2,
        });
    });

    test("主动好友申请保持 KOOK 来源语义", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        await executeKookPlatformAction({ callApi } as never, "send_friend_request", {
            user_code: "Alice#0001",
            from: 2,
            guild_id: "guild-1",
        });
        expect(callApi).toHaveBeenCalledWith("/v3/friend/request", {
            method: "POST",
            body: { user_code: "Alice#0001", from: 2, guild_id: "guild-1" },
        });

        await expect(
            executeKookPlatformAction({ callApi } as never, "send_friend_request", {
                user_code: "Alice#0001",
                from: 2,
            }),
        ).rejects.toMatchObject({ code: "KOOK_FRIEND_REQUEST_GUILD_REQUIRED" });
    });
});
