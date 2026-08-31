import { describe, expect, it, vi } from "vitest";
import type { HeychatBot } from "./bot.js";
import { HeychatApiError } from "./errors.js";
import { executeHeychatPlatformAction } from "./platform-actions.js";

describe("executeHeychatPlatformAction", () => {
    it("按官方路由执行具名动作", async () => {
        const callApi = vi.fn().mockResolvedValue({ ok: true });
        const bot = { callApi } as unknown as HeychatBot;

        await executeHeychatPlatformAction(bot, "move_voice_member", {
            room_id: "r1",
            origin_channel_id: "c1",
            channel_id: "c2",
            to_user_ids: ["42"],
        });

        expect(callApi).toHaveBeenCalledWith("/chatroom/v2/channel/move_member", {
            method: "POST",
            body: {
                room_id: "r1",
                origin_channel_id: "c1",
                channel_id: "c2",
                to_user_ids: ["42"],
            },
        });
    });

    it("按官方 schema 拒绝缺失、类型错误与影子字段", async () => {
        const bot = { callApi: vi.fn() } as unknown as HeychatBot;

        await expect(
            executeHeychatPlatformAction(bot, "move_voice_member", {
                room_id: "r1",
                origin_channel_id: "c1",
                channel_id: "c2",
                to_user_ids: [42],
            }),
        ).rejects.toMatchObject({ code: "HEYCHAT_ACTION_PARAM_INVALID" });
        await expect(
            executeHeychatPlatformAction(bot, "get_room", { room_id: "r1", typo: true }),
        ).rejects.toMatchObject({
            code: "HEYCHAT_ACTION_PARAM_UNKNOWN",
            details: { action: "get_room", parameter: "typo" },
        });
        await expect(
            executeHeychatPlatformAction(bot, "set_message_reaction", {
                msg_id: "m1",
                emoji: "[cube_doge]",
                is_add: 1,
                channel_id: "c1",
            }),
        ).rejects.toMatchObject({ code: "HEYCHAT_ACTION_PARAM_REQUIRED" });
    });

    it("分离官方 POST query 与 JSON body 并闭合嵌套权限项", async () => {
        const callApi = vi.fn().mockResolvedValue({ ok: true });
        const bot = { callApi } as unknown as HeychatBot;

        await executeHeychatPlatformAction(bot, "set_channel_permission", {
            heybox_id: "42",
            room_id: "r1",
            channel_id: "c1",
            roles: [{ role_id: "admin", allow: "1", channel_type: 1 }],
            users: [{ to_user_id: 42, deny: "2" }],
        });
        expect(callApi).toHaveBeenCalledWith("/chatroom/v2/role/role_user_perm", {
            method: "POST",
            query: { heybox_id: "42" },
            body: {
                room_id: "r1",
                channel_id: "c1",
                roles: [{ role_id: "admin", allow: "1", channel_type: 1 }],
                users: [{ to_user_id: 42, deny: "2" }],
            },
        });
        await expect(
            executeHeychatPlatformAction(bot, "set_channel_permission", {
                heybox_id: "42",
                room_id: "r1",
                channel_id: "c1",
                roles: [{ role_id: "admin", shadow: true }],
                users: [],
            }),
        ).rejects.toMatchObject({ code: "HEYCHAT_ACTION_PARAM_INVALID" });
    });

    it("底层入口只允许官方 chatroom 路径与 GET/POST", async () => {
        const bot = { callApi: vi.fn() } as unknown as HeychatBot;

        await expect(
            executeHeychatPlatformAction(bot, "call_heychat_api", {
                path: "https://evil.example/api",
            }),
        ).rejects.toBeInstanceOf(HeychatApiError);
        await expect(
            executeHeychatPlatformAction(bot, "call_heychat_api", {
                path: "/chatroom/v2/room/view",
                method: "DELETE",
            }),
        ).rejects.toBeInstanceOf(HeychatApiError);
        await expect(
            executeHeychatPlatformAction(bot, "call_heychat_api", {
                path: "/chatroom/v2/%2e%2e/token",
            }),
        ).rejects.toMatchObject({ code: "HEYCHAT_INVALID_ACTION_PARAMS" });
    });

    it("上传动作解码 Base64 并返回 URL", async () => {
        const uploadMedia = vi.fn().mockResolvedValue("https://cdn.example/a.png");
        const bot = { uploadMedia } as unknown as HeychatBot;
        await expect(
            executeHeychatPlatformAction(bot, "upload_media", {
                data: Buffer.from("image").toString("base64"),
                filename: "a.png",
                content_type: "image/png",
            }),
        ).resolves.toEqual({ url: "https://cdn.example/a.png" });
    });

    it("显式分发 OAuth 动作并拒绝影子参数", async () => {
        const buildOAuthAuthorizationUrl = vi.fn().mockReturnValue("https://oauth.example");
        const getOAuthVoiceDuration = vi.fn().mockResolvedValue({ durations: [] });
        const bot = {
            buildOAuthAuthorizationUrl,
            getOAuthVoiceDuration,
        } as unknown as HeychatBot;

        await expect(
            executeHeychatPlatformAction(bot, "create_oauth_authorization_url", {
                scope: ["user_info_read", "user_chat_duration_read"],
            }),
        ).resolves.toEqual({ url: "https://oauth.example" });
        expect(buildOAuthAuthorizationUrl).toHaveBeenCalledWith([
            "user_info_read",
            "user_chat_duration_read",
        ]);

        await executeHeychatPlatformAction(bot, "get_oauth_game_duration", {
            access_token: "access",
            room_id: "r1",
            begin_time: 100,
            end_time: 200,
            appid: "730",
        });
        expect(getOAuthVoiceDuration).toHaveBeenCalledWith("access", {
            room_id: "r1",
            begin_time: 100,
            end_time: 200,
            appid: "730",
        });
        await expect(
            executeHeychatPlatformAction(bot, "get_oauth_user_info", {
                access_token: "access",
                client_secret: "不应由动作传入",
            }),
        ).rejects.toMatchObject({
            code: "HEYCHAT_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "get_oauth_user_info", parameter: "client_secret" },
        });
    });

    it("底层调用与媒体上传同样拒绝契约外顶层字段", async () => {
        const bot = {} as HeychatBot;
        await expect(
            executeHeychatPlatformAction(bot, "call_heychat_api", {
                path: "/chatroom/v2/room/view",
                token: "不应透传",
            }),
        ).rejects.toMatchObject({
            code: "HEYCHAT_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "call_heychat_api", parameter: "token" },
        });
        await expect(
            executeHeychatPlatformAction(bot, "upload_media", {
                data: "aW1hZ2U=",
                filename: "a.png",
                path: "/tmp/a.png",
            }),
        ).rejects.toMatchObject({
            code: "HEYCHAT_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "upload_media", parameter: "path" },
        });
    });
});
