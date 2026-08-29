import { describe, expect, it, vi } from "vitest";
import { loadDiscordGuildMembers, loadDiscordGuilds, loadDiscordMessages } from "./resources.js";

describe("Discord resource pagination", () => {
    it("完整翻页 Guild，并在成功后原子替换缓存", async () => {
        const first = Array.from({ length: 200 }, (_, index) => ({
            id: String(index + 1),
            name: `guild-${index + 1}`,
        }));
        const getGuilds = vi
            .fn()
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce([{ id: "201", name: "guild-201" }]);
        const cache = new Map([["stale", { id: "stale", name: "stale" }]]);

        const result = await loadDiscordGuilds({ getGuilds } as never, cache as never);

        expect(result.size).toBe(201);
        expect(result.has("stale")).toBe(false);
        expect(getGuilds).toHaveBeenNthCalledWith(2, { limit: 200, after: "200" });
    });

    it("按 1000 人单页上限翻页成员", async () => {
        const member = (id: number) => ({
            user: {
                id: String(id),
                username: `user-${id}`,
                discriminator: "0",
                avatar: null,
            },
            roles: [],
            joined_at: "2026-01-01T00:00:00.000Z",
            deaf: false,
            mute: false,
        });
        const getGuildMembers = vi
            .fn()
            .mockResolvedValueOnce(Array.from({ length: 1_000 }, (_, index) => member(index + 1)))
            .mockResolvedValueOnce([member(1_001)]);

        const result = await loadDiscordGuildMembers({ getGuildMembers } as never, "guild");

        expect(result.size).toBe(1_001);
        expect(getGuildMembers).toHaveBeenNthCalledWith(2, "guild", {
            limit: 1_000,
            after: "1000",
        });
    });

    it("按 100 条单页上限读取指定数量的历史消息", async () => {
        const message = (id: number) => ({
            id: String(id),
            channel_id: "10",
            author: { id: "20", username: "alice", discriminator: "0", avatar: null },
            content: "hello",
            timestamp: "2026-01-01T00:00:00.000Z",
            edited_timestamp: null,
            tts: false,
            mention_everyone: false,
            mentions: [],
            mention_roles: [],
            attachments: [],
            embeds: [],
            pinned: false,
            type: 0,
        });
        const getMessages = vi
            .fn()
            .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => message(index + 1)))
            .mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => message(index + 101)));

        const result = await loadDiscordMessages({ getMessages } as never, "10", 120);

        expect(result.size).toBe(120);
        expect(getMessages).toHaveBeenNthCalledWith(2, "10", { limit: 20, before: "100" });
    });
});
