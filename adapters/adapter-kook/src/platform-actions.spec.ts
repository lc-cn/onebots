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
});
