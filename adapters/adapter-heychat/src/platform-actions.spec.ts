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
            to_user_ids: [42],
        });

        expect(callApi).toHaveBeenCalledWith("/chatroom/v2/channel/move_member", {
            method: "POST",
            body: {
                room_id: "r1",
                origin_channel_id: "c1",
                channel_id: "c2",
                to_user_ids: [42],
            },
        });
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
});
