import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { executeICQQPlatformAction } from "./platform-actions.js";

describe("ICQQ 平台扩展动作", () => {
    it("路由 ICQQ 专属资料动作并保留底层返回值", async () => {
        const setDescription = vi.fn().mockResolvedValue(true);
        const client = { setDescription } as unknown as Client;

        await expect(
            executeICQQPlatformAction(client, "set_description", { description: "OneBots" }),
        ).resolves.toBe(true);
        expect(setDescription).toHaveBeenCalledWith("OneBots");
    });

    it("在进入 ICQQ 前严格拒绝错误参数", async () => {
        const client = {} as Client;
        await expect(
            executeICQQPlatformAction(client, "set_online_status", { status: "online" }),
        ).rejects.toThrow("status 必须是安全整数");
        await expect(
            executeICQQPlatformAction(client, "send_temp_message", {
                group_id: 1,
                user_id: 2,
                message: "not-an-array",
            }),
        ).rejects.toThrow("message 必须是消息段数组");
        await expect(
            executeICQQPlatformAction(client, "set_group_join_type", {
                group_id: 1,
                type: "invalid",
            }),
        ).rejects.toThrow("type 必须是");
        await expect(
            executeICQQPlatformAction(client, "set_group_message_rate_limit", {
                group_id: 1,
                times: 3,
            }),
        ).rejects.toThrow("times 只能是 0、5 或 10");
    });

    it("字符串 QQ ID 可调用好友和群策略动作", async () => {
        const setRemark = vi.fn().mockResolvedValue(undefined);
        const getAtAllRemainder = vi.fn().mockResolvedValue(4);
        const client = {
            pickFriend: vi.fn(() => ({ setRemark })),
            pickGroup: vi.fn(() => ({ getAtAllRemainder })),
        } as unknown as Client;

        await executeICQQPlatformAction(client, "set_friend_remark", {
            user_id: "123456",
            remark: "同事",
        });
        await expect(
            executeICQQPlatformAction(client, "get_group_at_all_remainder", {
                group_id: "654321",
            }),
        ).resolves.toBe(4);
        expect(client.pickFriend).toHaveBeenCalledWith(123456);
        expect(client.pickGroup).toHaveBeenCalledWith(654321);
    });

    it("删除表态前校验消息归属并使用原生 seq", async () => {
        const delReaction = vi.fn().mockResolvedValue({ ok: true });
        const client = {
            getMsg: vi.fn().mockResolvedValue({
                message_type: "group",
                group_id: 100,
                seq: 42,
            }),
            pickGroup: vi.fn(() => ({ delReaction })),
        } as unknown as Client;

        await expect(
            executeICQQPlatformAction(client, "delete_group_message_reaction", {
                message_id: "message",
                group_id: "100",
                face_id: 66,
                face_type: 1,
            }),
        ).resolves.toEqual({ ok: true });
        expect(delReaction).toHaveBeenCalledWith(42, "66", 1);
        await expect(
            executeICQQPlatformAction(client, "delete_group_message_reaction", {
                message_id: "message",
                group_id: 101,
                face_id: 66,
            }),
        ).rejects.toThrow("消息不属于指定群");
    });
});
