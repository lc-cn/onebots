import { describe, expect, it, vi } from "vitest";
import { ZulipClient } from "./client.js";
import { executeZulipPlatformAction } from "./platform-actions.js";
import type { ZulipConfig } from "./types.js";

const config: ZulipConfig = {
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
};

describe("Zulip 定时消息动作", () => {
    it("使用现代 direct 与 channel 场景创建定时消息", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "create_scheduled_message", {
            type: "direct",
            to: [11, 12],
            content: "hello",
            scheduled_delivery_timestamp: 2_000_000_000,
            read_by_sender: true,
        });
        await executeZulipPlatformAction(client, "create_scheduled_message", {
            type: "channel",
            to: 7,
            topic: "",
            content: "release",
            scheduled_delivery_timestamp: 2_000_000_001,
        });

        expect(call).toHaveBeenNthCalledWith(1, "scheduled_messages", "POST", {
            type: "direct",
            to: [11, 12],
            content: "hello",
            scheduled_delivery_timestamp: 2_000_000_000,
            read_by_sender: true,
        });
        expect(call).toHaveBeenNthCalledWith(2, "scheduled_messages", "POST", {
            type: "channel",
            to: 7,
            topic: "",
            content: "release",
            scheduled_delivery_timestamp: 2_000_000_001,
        });
    });

    it("查询、编辑和删除使用独立资源路径", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_scheduled_messages", {});
        await executeZulipPlatformAction(client, "edit_scheduled_message", {
            scheduled_message_id: 17,
            type: "channel",
            to: 7,
            topic: "release",
        });
        await executeZulipPlatformAction(client, "delete_scheduled_message", {
            scheduled_message_id: 17,
        });

        expect(call).toHaveBeenNthCalledWith(1, "scheduled_messages");
        expect(call).toHaveBeenNthCalledWith(2, "scheduled_messages/17", "PATCH", {
            type: "channel",
            to: 7,
            topic: "release",
        });
        expect(call).toHaveBeenNthCalledWith(3, "scheduled_messages/17", "DELETE");
    });

    it.each([
        [
            "create_scheduled_message",
            { type: "private", to: [11], content: "x", scheduled_delivery_timestamp: 1 },
        ],
        [
            "create_scheduled_message",
            { type: "direct", to: [], content: "x", scheduled_delivery_timestamp: 1 },
        ],
        [
            "create_scheduled_message",
            {
                type: "direct",
                to: [11],
                topic: "ignored",
                content: "x",
                scheduled_delivery_timestamp: 1,
            },
        ],
        [
            "create_scheduled_message",
            { type: "channel", to: 7, content: "x", scheduled_delivery_timestamp: 1 },
        ],
        ["edit_scheduled_message", { scheduled_message_id: 17 }],
        ["edit_scheduled_message", { scheduled_message_id: 17, type: "direct" }],
        ["edit_scheduled_message", { scheduled_message_id: 17, extra: true }],
        ["delete_scheduled_message", { scheduled_message_id: 17, content: "x" }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
