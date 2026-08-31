import type { LineBotClient } from "@line/bot-sdk";
import { describe, expect, it, vi } from "vitest";
import { listLineFollowerIds, listLineMemberProfiles } from "./directory.js";

describe("LINE 目录", () => {
    it("关注者分页去重并拒绝停滞游标", async () => {
        const getFollowers = vi
            .fn()
            .mockResolvedValueOnce({ userIds: ["u1", "u2"], next: "next" })
            .mockResolvedValueOnce({ userIds: ["u2", "u3"] });
        const client = { getFollowers } as unknown as LineBotClient;

        await expect(listLineFollowerIds(client)).resolves.toEqual(["u1", "u2", "u3"]);

        getFollowers
            .mockReset()
            .mockResolvedValueOnce({ userIds: ["u1"], next: "same" })
            .mockResolvedValueOnce({ userIds: ["u2"], next: "same" });
        await expect(listLineFollowerIds(client)).rejects.toMatchObject({
            code: "LINE_CURSOR_STALLED",
        });
    });

    it("成员资料以固定并发读取并保持目录顺序", async () => {
        const memberIds = Array.from({ length: 23 }, (_, index) => `u${index}`);
        let active = 0;
        let maximumActive = 0;
        const getGroupMemberProfile = vi.fn(async (_groupId: string, userId: string) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active -= 1;
            return { userId, displayName: userId };
        });
        const client = {
            getGroupMembersIds: vi.fn().mockResolvedValue({ memberIds }),
            getGroupMemberProfile,
        } as unknown as LineBotClient;

        const profiles = await listLineMemberProfiles(client, { id: "g1", type: "group" });

        expect(profiles.map(profile => profile.userId)).toEqual(memberIds);
        expect(maximumActive).toBe(10);
    });
});
