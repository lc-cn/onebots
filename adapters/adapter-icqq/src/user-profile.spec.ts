import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { getICQQUserProfile } from "./user-profile.js";

describe("ICQQ 用户资料卡", () => {
    it("聚合简单资料、资料卡与好友备注", async () => {
        const client = {
            getStrangerInfo: vi.fn().mockResolvedValue({
                user_id: 10001,
                nickname: "simple",
                sex: "unknown",
                age: 20,
                area: "Manila",
            }),
            pickUser: vi.fn().mockReturnValue({
                getProfile: vi.fn().mockResolvedValue({
                    nickname: "Alice",
                    sex: "female",
                    age: 21,
                    QID: "alice",
                    signature: "OneBots",
                    level: 42,
                }),
            }),
            fl: new Map([[10001, { remark: "A" }]]),
        } as unknown as Client;

        await expect(getICQQUserProfile(client, 10001)).resolves.toEqual({
            user_id: 10001,
            nickname: "Alice",
            sex: "female",
            age: 21,
            qid: "alice",
            remark: "A",
            bio: "OneBots",
            level: 42,
            area: "Manila",
            avatar: "https://q1.qlogo.cn/g?b=qq&nk=10001&s=640",
        });
    });
});
