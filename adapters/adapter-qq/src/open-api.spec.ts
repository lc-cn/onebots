import { describe, expect, it, vi } from "vitest";
import type { QQClient } from "./client.js";
import { QQOpenApi, type QQGuild } from "./open-api.js";

describe("QQOpenApi", () => {
    it("自动遍历频道分页且保留游标", async () => {
        const first = Array.from(
            { length: 100 },
            (_, index): QQGuild => ({
                id: `g${index}`,
                name: `Guild ${index}`,
            }),
        );
        const call = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([]);
        const api = new QQOpenApi({ call } as unknown as QQClient);
        await expect(api.listGuilds()).resolves.toHaveLength(100);
        expect(call).toHaveBeenNthCalledWith(2, {
            method: "GET",
            path: "/users/@me/guilds",
            query: { limit: 100, after: "g99" },
        });
    });

    it("拒绝停滞的频道分页游标而不是静默返回截断列表", async () => {
        const page = Array.from(
            { length: 100 },
            (_, index): QQGuild => ({ id: index === 99 ? "same" : `g${index}`, name: "Guild" }),
        );
        const call = vi.fn().mockResolvedValue(page);
        const api = new QQOpenApi({ call } as unknown as QQClient);

        await expect(api.listGuilds()).rejects.toMatchObject({ code: "QQ_PAGINATION_STALLED" });
        expect(call).toHaveBeenCalledTimes(2);
    });
});
