import type { Adapter } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { executeMilkyDirectoryAction } from "./directory-actions.js";

const id = (value: number) => ({ string: String(value), number: value, source: value });

describe("Milky 目录动作", () => {
    it("传递 no_cache 并在 Adapter 前验证 ID", async () => {
        const getFriendInfo = vi.fn().mockResolvedValue({
            user_id: id(10001),
            user_name: "Alice",
            sex: "female",
            category_id: 2,
            category_name: "朋友",
        });
        const adapter = {
            resolveId: id,
            getFriendInfo,
        } as unknown as Adapter;

        await executeMilkyDirectoryAction(adapter, "bot", "get_friend_info", {
            user_id: 10001,
            no_cache: true,
        });
        expect(getFriendInfo).toHaveBeenCalledWith("bot", {
            user_id: expect.objectContaining({ number: 10001 }),
            no_cache: true,
        });
        await expect(
            executeMilkyDirectoryAction(adapter, "bot", "get_friend_info", { user_id: 0 }),
        ).rejects.toThrow("user_id");
    });

    it("闭合戳一戳与点赞默认值并返回空对象", async () => {
        const sendFriendNudge = vi.fn();
        const sendLike = vi.fn();
        const adapter = {
            resolveId: id,
            sendFriendNudge,
            sendLike,
        } as unknown as Adapter;

        await expect(
            executeMilkyDirectoryAction(adapter, "bot", "send_friend_nudge", {
                user_id: 10001,
            }),
        ).resolves.toEqual({});
        await expect(
            executeMilkyDirectoryAction(adapter, "bot", "send_profile_like", {
                user_id: 10001,
            }),
        ).resolves.toEqual({});
        expect(sendFriendNudge).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({ is_self: false }),
        );
        expect(sendLike).toHaveBeenCalledWith("bot", expect.objectContaining({ count: 1 }));
    });
});
