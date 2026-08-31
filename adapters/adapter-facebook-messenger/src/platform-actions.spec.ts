import { describe, expect, it, vi } from "vitest";
import type { FacebookMessengerClient } from "./client.js";
import { executeFacebookMessengerPlatformAction } from "./platform-actions.js";

describe("Facebook Messenger 平台动作", () => {
    it("使用官方 Page edges 执行订阅、Profile、审核与 Handover", async () => {
        const call = vi.fn().mockResolvedValue({ success: true });
        const client = {
            config: { page_id: "100" },
            call,
        } as unknown as FacebookMessengerClient;

        await executeFacebookMessengerPlatformAction(client, "subscribe_facebook_messenger_page", {
            subscribed_fields: ["messages", "message_reads"],
        });
        expect(call).toHaveBeenLastCalledWith("POST", "/100/subscribed_apps", {
            query: { subscribed_fields: "messages,message_reads" },
        });

        await executeFacebookMessengerPlatformAction(client, "set_facebook_messenger_profile", {
            profile: { get_started: { payload: "START" } },
        });
        expect(call).toHaveBeenLastCalledWith("POST", "/100/messenger_profile", {
            body: { get_started: { payload: "START" } },
        });

        await executeFacebookMessengerPlatformAction(
            client,
            "moderate_facebook_messenger_conversation",
            { user_ids: ["201", "202"], action: "block_user" },
        );
        expect(call).toHaveBeenLastCalledWith("POST", "/100/moderate_conversations", {
            body: {
                user_ids: [{ id: "201" }, { id: "202" }],
                actions: ["block_user"],
            },
        });

        await executeFacebookMessengerPlatformAction(
            client,
            "pass_facebook_messenger_thread_control",
            { recipient_id: "201", target_app_id: "300", metadata: "handoff" },
        );
        expect(call).toHaveBeenLastCalledWith("POST", "/100/pass_thread_control", {
            body: {
                recipient: { id: "201" },
                target_app_id: "300",
                metadata: "handoff",
            },
        });
    });

    it("generic call 只接受受限 method/path/query JSON，并拒绝未知枚举", async () => {
        const call = vi.fn().mockResolvedValue({});
        const client = {
            config: { page_id: "100" },
            call,
        } as unknown as FacebookMessengerClient;
        await executeFacebookMessengerPlatformAction(client, "call_facebook_messenger_api", {
            method: "GET",
            path: "/page",
            query: { fields: ["id", "name"], limit: 5 },
        });
        expect(call).toHaveBeenCalledWith("GET", "/page", {
            query: { fields: ["id", "name"], limit: 5 },
            body: undefined,
        });
        await expect(
            executeFacebookMessengerPlatformAction(
                client,
                "moderate_facebook_messenger_conversation",
                { user_ids: ["201"], action: "silence_forever" },
            ),
        ).rejects.toThrow(/moderation action/u);
        await expect(
            executeFacebookMessengerPlatformAction(client, "call_facebook_messenger_api", {
                method: "PATCH",
                path: "/page",
            }),
        ).rejects.toThrow(/GET、POST 或 DELETE/u);
        await expect(
            executeFacebookMessengerPlatformAction(client, "subscribe_facebook_messenger_page", {
                subscribed_fields: ["future_field"],
            }),
        ).rejects.toThrow(/未定义字段/u);
    });

    it("Utility Messaging 使用独立模板接口和 UTILITY 发送类型", async () => {
        const call = vi
            .fn()
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ id: "template-id" })
            .mockResolvedValueOnce({ recipient_id: "200", message_id: "m1" });
        const client = {
            config: { page_id: "100" },
            call,
            send: vi.fn(async (recipientId, message, options) => {
                await call("POST", "/100/messages", {
                    body: {
                        recipient: { id: recipientId },
                        messaging_type: options.messagingType,
                        message,
                    },
                });
                return { recipient_id: recipientId, message_id: "m1" };
            }),
        } as unknown as FacebookMessengerClient;

        await executeFacebookMessengerPlatformAction(
            client,
            "search_facebook_messenger_template_library",
            { name_or_content: "receipt", language: "en_US", limit: 10 },
        );
        expect(call).toHaveBeenNthCalledWith(1, "GET", "/message_template_library", {
            query: {
                name_or_content: "receipt",
                language: "en_US",
                limit: 10,
                after: undefined,
            },
        });

        await executeFacebookMessengerPlatformAction(
            client,
            "create_facebook_messenger_utility_template",
            {
                template: {
                    name: "order_update",
                    language: "en_US",
                    library_template_name: "order_confirmation_1",
                },
            },
        );
        expect(call).toHaveBeenNthCalledWith(2, "POST", "/100/message_templates", {
            body: {
                name: "order_update",
                language: "en_US",
                library_template_name: "order_confirmation_1",
                category: "UTILITY",
            },
        });

        await executeFacebookMessengerPlatformAction(
            client,
            "send_facebook_messenger_utility_template",
            {
                recipient_id: "200",
                template: { name: "order_update", language: { code: "en_US" } },
            },
        );
        expect(client.send).toHaveBeenCalledWith(
            "200",
            { template: { name: "order_update", language: { code: "en_US" } } },
            { messagingType: "UTILITY" },
        );
    });

    it("Utility 模板拒绝营销类别、非法名称和不完整模板", async () => {
        const client = {
            config: { page_id: "100" },
            call: vi.fn(),
        } as unknown as FacebookMessengerClient;
        await expect(
            executeFacebookMessengerPlatformAction(
                client,
                "create_facebook_messenger_utility_template",
                { template: { name: "Bad Name", language: "en_US", components: [{}] } },
            ),
        ).rejects.toThrow(/小写字母/u);
        await expect(
            executeFacebookMessengerPlatformAction(
                client,
                "create_facebook_messenger_utility_template",
                {
                    template: {
                        name: "promotion",
                        language: "en_US",
                        category: "MARKETING",
                        components: [{}],
                    },
                },
            ),
        ).rejects.toThrow(/UTILITY/u);
        await expect(
            executeFacebookMessengerPlatformAction(
                client,
                "create_facebook_messenger_utility_template",
                { template: { name: "empty", language: "en_US" } },
            ),
        ).rejects.toThrow(/library_template_name 或 components/u);
    });
});
