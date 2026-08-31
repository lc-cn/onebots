import { describe, expect, it, vi } from "vitest";
import { listWechatFollowers } from "./directory.js";

describe("微信公众号关注者目录", () => {
    it("完整分页、去重并过滤已取消关注资料", async () => {
        const client = {
            getUserList: vi
                .fn()
                .mockResolvedValueOnce({
                    total: 3,
                    count: 2,
                    data: { openid: ["u1", "u2"] },
                    next_openid: "u2",
                })
                .mockResolvedValueOnce({
                    total: 3,
                    count: 2,
                    data: { openid: ["u2", "u3"] },
                    next_openid: "",
                }),
            batchGetUserInfo: vi.fn(async (openids: string[]) =>
                openids.map(openid => ({
                    openid,
                    subscribe: openid === "u3" ? 0 : 1,
                })),
            ),
        };
        await expect(listWechatFollowers(client)).resolves.toEqual([
            { openid: "u1", subscribe: 1 },
            { openid: "u2", subscribe: 1 },
        ]);
        expect(client.batchGetUserInfo).toHaveBeenNthCalledWith(2, ["u3"]);
    });

    it("拒绝重复游标", async () => {
        const client = {
            getUserList: vi.fn().mockResolvedValue({
                total: 1,
                count: 1,
                data: { openid: ["u1"] },
                next_openid: "same",
            }),
            batchGetUserInfo: vi.fn().mockResolvedValue([]),
        };
        await expect(listWechatFollowers(client)).rejects.toMatchObject({
            code: "WECHAT_CURSOR_STALLED",
        });
    });
});
