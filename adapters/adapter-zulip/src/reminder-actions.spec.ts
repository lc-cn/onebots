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

describe("Zulip 消息提醒动作", () => {
    it("查询、创建和删除使用官方资源契约", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_reminders", {});
        await executeZulipPlatformAction(client, "create_reminder", {
            message_id: 42,
            scheduled_delivery_timestamp: 2_000_000_000,
            note: "检查发布结果",
        });
        await executeZulipPlatformAction(client, "delete_reminder", { reminder_id: 17 });

        expect(call).toHaveBeenNthCalledWith(1, "reminders");
        expect(call).toHaveBeenNthCalledWith(2, "reminders", "POST", {
            message_id: 42,
            scheduled_delivery_timestamp: 2_000_000_000,
            note: "检查发布结果",
        });
        expect(call).toHaveBeenNthCalledWith(3, "reminders/17", "DELETE");
    });

    it.each([
        ["create_reminder", { message_id: 42 }],
        ["create_reminder", { message_id: -1, scheduled_delivery_timestamp: 1 }],
        ["create_reminder", { message_id: 42, scheduled_delivery_timestamp: 1, note: 1 }],
        ["create_reminder", { message_id: 42, scheduled_delivery_timestamp: 1, extra: true }],
        ["delete_reminder", {}],
        ["delete_reminder", { reminder_id: 17, extra: true }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
