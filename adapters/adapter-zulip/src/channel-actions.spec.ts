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

describe("Zulip 频道资源动作", () => {
    it("覆盖频道 ID、话题、订阅和成员可见频道", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "get_channel_id", { stream: "engineering" });
        await executeZulipPlatformAction(client, "get_channel_topics", {
            stream_id: 7,
            allow_empty_topic_name: true,
        });
        await executeZulipPlatformAction(client, "get_channel_subscriptions", {
            include_subscribers: false,
        });
        await executeZulipPlatformAction(client, "get_channel_subscription_status", {
            user_id: 11,
            stream_id: 7,
        });
        await executeZulipPlatformAction(client, "get_user_channels", { user_id: 11 });

        expect(call).toHaveBeenNthCalledWith(1, "get_stream_id", "GET", {
            stream: "engineering",
        });
        expect(call).toHaveBeenNthCalledWith(2, "users/me/7/topics", "GET", {
            allow_empty_topic_name: true,
        });
        expect(call).toHaveBeenNthCalledWith(3, "users/me/subscriptions", "GET", {
            include_subscribers: false,
        });
        expect(call).toHaveBeenNthCalledWith(4, "users/11/subscriptions/7");
        expect(call).toHaveBeenNthCalledWith(5, "users/11/channels");
    });

    it("覆盖现代频道目录、详情、邮件地址和话题删除", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "list_zulip_channels", {
            include_all: true,
            exclude_archived: false,
            include_can_access_content: true,
        });
        await executeZulipPlatformAction(client, "get_zulip_channel", { stream_id: 7 });
        await executeZulipPlatformAction(client, "get_channel_email_address", {
            stream_id: 7,
            sender_id: 11,
        });
        await executeZulipPlatformAction(client, "delete_channel_topic", {
            stream_id: 7,
            topic_name: "",
        });

        expect(call).toHaveBeenNthCalledWith(1, "streams", "GET", {
            include_all: true,
            exclude_archived: false,
            include_can_access_content: true,
        });
        expect(call).toHaveBeenNthCalledWith(2, "streams/7");
        expect(call).toHaveBeenNthCalledWith(3, "streams/7/email_address", "GET", {
            sender_id: 11,
        });
        expect(call).toHaveBeenNthCalledWith(4, "streams/7/delete_topic", "POST", {
            topic_name: "",
        });
    });

    it("归档使用官方 DELETE，恢复使用现代频道更新", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "archive_channel", { stream_id: 7 });
        await executeZulipPlatformAction(client, "unarchive_channel", { stream_id: 7 });

        expect(call).toHaveBeenNthCalledWith(1, "streams/7", "DELETE");
        expect(call).toHaveBeenNthCalledWith(2, "streams/7", "PATCH", {
            is_archived: false,
        });
    });

    it.each([
        ["get_channel_id", { stream: "" }],
        ["get_channel_topics", { stream_id: 7, allow_empty_topic_name: "true" }],
        ["get_channel_subscriptions", { include_subscribers: 1 }],
        ["get_channel_subscription_status", { user_id: 1 }],
        ["list_zulip_channels", { include_all_active: true }],
        ["get_zulip_channel", { stream_id: 7, extra: true }],
        ["get_channel_email_address", { stream_id: 7, sender_id: -1 }],
        ["delete_channel_topic", { stream_id: 7 }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
