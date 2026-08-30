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

    it("批量与单频道更新现代订阅属性", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        const subscriptionData = [
            { stream_id: 7, property: "is_muted", value: true },
            { stream_id: 9, property: "color", value: "#a1B2c3" },
        ];

        await executeZulipPlatformAction(client, "update_channel_subscription_settings", {
            subscription_data: subscriptionData,
        });
        await executeZulipPlatformAction(client, "update_channel_subscription_property", {
            stream_id: 7,
            property: "wildcard_mentions_notify",
            value: false,
        });

        expect(call).toHaveBeenNthCalledWith(1, "users/me/subscriptions/properties", "POST", {
            subscription_data: subscriptionData,
        });
        expect(call).toHaveBeenNthCalledWith(2, "users/me/subscriptions/7", "PATCH", {
            property: "wildcard_mentions_notify",
            value: false,
        });
    });

    it("按现代契约订阅、更新与取消订阅频道", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "subscribe_channels", {
            subscriptions: [{ name: "engineering", description: "Engineering" }],
            principals: [11, 12],
            topics_policy: "disable_empty_topic",
            can_send_message_group: { direct_members: [11], direct_subgroups: [4] },
        });
        await executeZulipPlatformAction(client, "update_channel_subscriptions", {
            delete: ["old"],
            add: [{ name: "release", color: "#a1b2c3" }],
        });
        await executeZulipPlatformAction(client, "unsubscribe_channels", {
            subscriptions: ["engineering"],
            principals: [11],
        });

        expect(call).toHaveBeenNthCalledWith(1, "users/me/subscriptions", "POST", {
            subscriptions: [{ name: "engineering", description: "Engineering" }],
            principals: [11, 12],
            topics_policy: "disable_empty_topic",
            can_send_message_group: { direct_members: [11], direct_subgroups: [4] },
        });
        expect(call).toHaveBeenNthCalledWith(2, "users/me/subscriptions", "PATCH", {
            delete: ["old"],
            add: [{ name: "release", color: "#a1b2c3" }],
        });
        expect(call).toHaveBeenNthCalledWith(3, "users/me/subscriptions", "DELETE", {
            subscriptions: ["engineering"],
            principals: [11],
        });
    });

    it("按 Zulip 11+ 独立端点创建频道", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
        const params = {
            name: "platform",
            description: "Platform engineering",
            subscribers: [11, 12],
            announce: true,
            topics_policy: "disable_empty_topic",
            can_send_message_group: { direct_members: [11], direct_subgroups: [4] },
        };

        await executeZulipPlatformAction(client, "create_zulip_channel", params);

        expect(call).toHaveBeenCalledWith("channels/create", "POST", params);
    });

    it("按现代契约更新频道及权限组", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "update_zulip_channel", {
            stream_id: 7,
            new_name: "platform",
            folder_id: null,
            can_administer_channel_group: {
                old: 2,
                new: { direct_members: [11], direct_subgroups: [] },
            },
        });

        expect(call).toHaveBeenCalledWith("streams/7", "PATCH", {
            new_name: "platform",
            folder_id: null,
            can_administer_channel_group: {
                old: 2,
                new: { direct_members: [11], direct_subgroups: [] },
            },
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
        ["update_channel_subscription_settings", { subscription_data: [] }],
        [
            "update_channel_subscription_settings",
            { subscription_data: [{ stream_id: 7, property: "in_home_view", value: true }] },
        ],
        ["update_channel_subscription_property", { stream_id: 7, property: "color", value: "red" }],
        ["subscribe_channels", { subscriptions: [{ name: "x" }], stream_post_policy: 1 }],
        ["subscribe_channels", { subscriptions: [], principals: [1] }],
        ["subscribe_channels", { subscriptions: [{ name: "x" }], folder_id: null }],
        ["subscribe_channels", { subscriptions: [{ name: "x" }], principals: [1, "user@x"] }],
        ["update_channel_subscriptions", {}],
        ["update_channel_subscriptions", { add: [{ name: "x", color: "red" }] }],
        ["unsubscribe_channels", { subscriptions: "engineering" }],
        ["create_zulip_channel", { subscribers: [1] }],
        ["create_zulip_channel", { name: "x" }],
        ["create_zulip_channel", { name: "x", subscribers: [], stream_post_policy: 1 }],
        [
            "create_zulip_channel",
            { name: "x", subscribers: [], can_send_message_group: { new: 2 } },
        ],
        ["create_zulip_channel", { name: "x", subscribers: [], folder_id: null }],
        ["update_zulip_channel", { stream_id: 7, is_announcement_only: true }],
        ["update_zulip_channel", { stream_id: 7, is_archived: true }],
        ["update_zulip_channel", { stream_id: 7, can_send_message_group: { direct_members: [1] } }],
    ])("%s 在请求前拒绝无效参数", async (action, params) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call");

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});
