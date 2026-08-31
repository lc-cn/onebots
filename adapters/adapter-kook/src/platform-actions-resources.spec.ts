import { describe, expect, test, vi } from "vitest";
import { executeKookPlatformAction } from "./platform-actions.js";

describe("KOOK 资源平台动作", () => {
    test("闭合服务器表情的分页、命名和删除字段", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "list_guild_emojis", {
            guild_id: "guild-1",
            page: 1,
            page_size: 50,
        });
        await executeKookPlatformAction(bot, "update_guild_emoji", {
            id: "emoji-1",
            name: "smile",
        });
        await executeKookPlatformAction(bot, "delete_guild_emoji", { id: "emoji-1" });

        expect(callApi.mock.calls).toEqual([
            ["/v3/guild-emoji/list", { query: { guild_id: "guild-1", page: 1, page_size: 50 } }],
            ["/v3/guild-emoji/update", { method: "POST", body: { id: "emoji-1", name: "smile" } }],
            ["/v3/guild-emoji/delete", { method: "POST", body: { id: "emoji-1" } }],
        ]);

        await expect(
            executeKookPlatformAction(bot, "update_guild_emoji", {
                id: "emoji-1",
                name: "x",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
    });

    test("按动态类型验证游戏和音乐活动字段", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "set_game_activity", {
            id: 42,
            data_type: 1,
        });
        await executeKookPlatformAction(bot, "set_game_activity", {
            data_type: 2,
            software: "kugou",
            singer: "歌手",
            music_name: "歌曲",
        });

        expect(callApi.mock.calls).toEqual([
            [
                "/v3/game/activity",
                {
                    method: "POST",
                    body: { id: 42, data_type: 1 },
                },
            ],
            [
                "/v3/game/activity",
                {
                    method: "POST",
                    body: {
                        data_type: 2,
                        software: "kugou",
                        singer: "歌手",
                        music_name: "歌曲",
                    },
                },
            ],
        ]);

        await expect(
            executeKookPlatformAction(bot, "set_game_activity", { data_type: 1 }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
        await expect(
            executeKookPlatformAction(bot, "set_game_activity", {
                data_type: 2,
                singer: "歌手",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
    });

    test("帖子删除表达 one-of，列表保持官方分页与排序", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "list_threads", {
            channel_id: "channel-1",
            category_id: "category-1",
            sort: 2,
            page_size: 30,
            time: 123,
        });
        await executeKookPlatformAction(bot, "list_thread_posts", {
            channel_id: "channel-1",
            thread_id: "thread-1",
            order: "asc",
            page: 1,
        });
        await executeKookPlatformAction(bot, "delete_thread_item", {
            channel_id: "channel-1",
            post_id: "post-1",
        });

        expect(callApi.mock.calls).toEqual([
            [
                "/v3/thread/list",
                {
                    query: {
                        channel_id: "channel-1",
                        category_id: "category-1",
                        sort: 2,
                        page_size: 30,
                        time: 123,
                    },
                },
            ],
            [
                "/v3/thread/post",
                {
                    query: {
                        channel_id: "channel-1",
                        thread_id: "thread-1",
                        order: "asc",
                        page: 1,
                    },
                },
            ],
            [
                "/v3/thread/delete",
                { method: "POST", body: { channel_id: "channel-1", post_id: "post-1" } },
            ],
        ]);

        await expect(
            executeKookPlatformAction(bot, "delete_thread_item", {
                channel_id: "channel-1",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
    });
});
