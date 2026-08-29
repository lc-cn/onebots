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

    test("通用动作拒绝跳出 /v3 API", () => {
        expect(() =>
            executeKookPlatformAction({ callApi: vi.fn() } as never, "call_kook_api", {
                path: "/api/config",
            }),
        ).toThrow("/v3/");
    });
});
