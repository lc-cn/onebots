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

    test("消息回应与置顶动作按官方字段闭合", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "get_message_reactions", {
            msg_id: "message",
            emoji: "smile",
        });
        expect(callApi).toHaveBeenCalledWith("/v3/message/reaction-list", {
            query: { msg_id: "message", emoji: "smile" },
        });

        await expect(
            executeKookPlatformAction(bot, "pin_message", {
                msg_id: "message",
                target_id: "channel",
                guild_id: "shadow",
            }),
        ).rejects.toMatchObject({
            code: "KOOK_ACTION_PARAM_UNKNOWN",
            details: { action: "pin_message", key: "guild_id" },
        });
        await expect(
            executeKookPlatformAction(bot, "add_direct_message_reaction", {
                msg_id: "message",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
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

    test("服务器管理动作使用稳定详情格式并拒绝兼容字段", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "list_guild_mutes", { guild_id: "guild" });
        expect(callApi).toHaveBeenCalledWith("/v3/guild-mute/list", {
            query: { guild_id: "guild", return_type: "detail" },
        });
        await expect(
            executeKookPlatformAction(bot, "list_guild_mutes", {
                guild_id: "guild",
                return_type: "legacy",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
    });

    test("服务器管理动作校验平台约束", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await expect(
            executeKookPlatformAction(bot, "add_blacklist", {
                guild_id: "guild",
                target_id: "user",
                del_msg_days: 8,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "add_guild_mute", {
                guild_id: "guild",
                user_id: "user",
                type: 3,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "set_guild_member_nickname", {
                guild_id: "guild",
                nickname: "x",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "list_blacklist", {
                guild_id: "guild",
                page_size: 51,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
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

    test("消息模板动作严格校验官方必填字段与枚举", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "create_message_template", {
            title: "通知模板",
            content: "{{ message }}",
            msgtype: 1,
            type: 0,
        });
        expect(callApi).toHaveBeenCalledWith("/v3/template/create", {
            method: "POST",
            body: {
                title: "通知模板",
                content: "{{ message }}",
                msgtype: 1,
                type: 0,
            },
        });

        await expect(
            executeKookPlatformAction(bot, "create_message_template", {
                title: "缺少内容",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
        await expect(
            executeKookPlatformAction(bot, "update_message_template", {
                id: "template",
                msgtype: 4,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "delete_message_template", {
                id: "template",
                title: "shadow",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_UNKNOWN" });
    });

    test("邀请动作表达目标 one-of 与官方枚举", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "create_invite", {
            guild_id: "guild",
            duration: 3_600,
            setting_times: 5,
        });
        expect(callApi).toHaveBeenCalledWith("/v3/invite/create", {
            method: "POST",
            body: { guild_id: "guild", duration: 3_600, setting_times: 5 },
        });

        await expect(executeKookPlatformAction(bot, "list_invites", {})).rejects.toMatchObject({
            code: "KOOK_ACTION_PARAM_REQUIRED",
            details: { action: "list_invites", keys: ["guild_id", "channel_id"] },
        });
        await expect(
            executeKookPlatformAction(bot, "create_invite", {
                channel_id: "channel",
                duration: 60,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "list_invitees", { page: 1 }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
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

    test("OAuth 动作保持应用凭据与用户令牌边界", async () => {
        const buildOAuthAuthorizationUrl = vi.fn().mockReturnValue("https://oauth.test");
        const exchangeOAuthCode = vi.fn().mockResolvedValue({ access_token: "token" });
        const getOAuthUserInfo = vi.fn().mockResolvedValue({ id: "user" });
        const listOAuthUserGuilds = vi.fn().mockResolvedValue({ items: [] });
        const bot = {
            buildOAuthAuthorizationUrl,
            exchangeOAuthCode,
            getOAuthUserInfo,
            listOAuthUserGuilds,
        } as never;

        await executeKookPlatformAction(bot, "create_oauth_authorization_url", {
            scope: ["get_user_info", "get_user_guilds"],
            state: "csrf",
        });
        await executeKookPlatformAction(bot, "exchange_oauth_code", { code: "code" });
        await executeKookPlatformAction(bot, "get_oauth_user_info", {
            access_token: "user-token",
        });
        await executeKookPlatformAction(bot, "list_oauth_user_guilds", {
            access_token: "user-token",
            page: 2,
            page_size: 50,
        });

        expect(buildOAuthAuthorizationUrl).toHaveBeenCalledWith(
            ["get_user_info", "get_user_guilds"],
            "csrf",
        );
        expect(exchangeOAuthCode).toHaveBeenCalledWith("code");
        expect(getOAuthUserInfo).toHaveBeenCalledWith("user-token");
        expect(listOAuthUserGuilds).toHaveBeenCalledWith("user-token", {
            page: 2,
            page_size: 50,
            sort: undefined,
        });
        await expect(
            executeKookPlatformAction(bot, "exchange_oauth_code", {
                code: "code",
                client_secret: "shadow",
            }),
        ).rejects.toMatchObject({
            code: "KOOK_ACTION_PARAM_UNKNOWN",
            details: { action: "exchange_oauth_code", key: "client_secret" },
        });
    });

    test("底层调用与资源动作拒绝契约外顶层字段", async () => {
        const bot = {} as never;
        await expect(
            executeKookPlatformAction(bot, "call_kook_api", {
                path: "/v3/user/me",
                token: "不应透传",
            }),
        ).rejects.toMatchObject({
            code: "KOOK_ACTION_PARAM_UNKNOWN",
            details: { action: "call_kook_api", key: "token" },
        });
        await expect(
            executeKookPlatformAction(bot, "get_guild_badge", {
                guild_id: "guild",
                format: "svg",
            }),
        ).rejects.toMatchObject({
            code: "KOOK_ACTION_PARAM_UNKNOWN",
            details: { action: "get_guild_badge", key: "format" },
        });
    });
});
