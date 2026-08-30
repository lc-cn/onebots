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

describe("Zulip 活动状态动作", () => {
    it("更新话题可见性并使用现代增量 Presence", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        await executeZulipPlatformAction(client, "set_topic_visibility", {
            stream_id: 7,
            topic: "",
            visibility_policy: 3,
        });
        await executeZulipPlatformAction(client, "update_presence", {
            status: "active",
            last_update_id: -1,
            history_limit_days: 30,
            ping_only: false,
        });
        await executeZulipPlatformAction(client, "get_user_presence", {
            user_id_or_email: "user@example.com",
        });
        expect(call).toHaveBeenNthCalledWith(1, "user_topics", "POST", {
            stream_id: 7,
            topic: "",
            visibility_policy: 3,
        });
        expect(call).toHaveBeenNthCalledWith(2, "users/me/presence", "POST", {
            status: "active",
            last_update_id: -1,
            history_limit_days: 30,
            ping_only: false,
        });
        expect(call).toHaveBeenNthCalledWith(3, "users/user%40example.com/presence");
    });

    it("发送 direct、channel 与消息编辑输入状态", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        await executeZulipPlatformAction(client, "send_typing_notification", {
            type: "direct",
            op: "start",
            to: [11],
        });
        await executeZulipPlatformAction(client, "send_typing_notification", {
            type: "channel",
            op: "stop",
            stream_id: 7,
            topic: "release",
        });
        await executeZulipPlatformAction(client, "send_message_edit_typing_notification", {
            message_id: 42,
            op: "start",
        });
        expect(call).toHaveBeenNthCalledWith(1, "typing", "POST", {
            type: "direct",
            op: "start",
            to: [11],
        });
        expect(call).toHaveBeenNthCalledWith(2, "typing", "POST", {
            type: "channel",
            op: "stop",
            stream_id: 7,
            topic: "release",
        });
        expect(call).toHaveBeenNthCalledWith(3, "messages/42/typing", "POST", { op: "start" });
    });

    it.each([
        ["set_topic_visibility", { stream_id: 7, topic: "x", visibility_policy: 4 }],
        ["update_presence", { status: "active", slim_presence: true }],
        ["update_presence", { status: "away" }],
        ["send_typing_notification", { type: "stream", op: "start", stream_id: 7, topic: "x" }],
        ["send_typing_notification", { type: "direct", op: "start", to: [] }],
        ["send_typing_notification", { type: "channel", op: "start", stream_id: 7 }],
        ["send_message_edit_typing_notification", { message_id: 42, op: "pause" }],
    ])("%s 拒绝旧式或无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");
        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
