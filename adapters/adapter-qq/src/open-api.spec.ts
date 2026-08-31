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
});
