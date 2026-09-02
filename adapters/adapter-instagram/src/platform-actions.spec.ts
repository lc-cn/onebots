import { describe, expect, it, vi } from "vitest";
import type { InstagramClient } from "./client.js";
import { executeInstagramPlatformAction } from "./platform-actions.js";

describe("Instagram platform actions", () => {
    it("Human Agent 是显式动作，不污染普通 send", async () => {
        const send = vi.fn().mockResolvedValue({ recipient_id: "200", message_id: "m1" });
        const client = { send } as unknown as InstagramClient;
        await executeInstagramPlatformAction(client, "send_instagram_human_agent", {
            recipient_id: "200",
            message: { text: "human support" },
        });
        expect(send).toHaveBeenCalledWith("200", { text: "human support" }, { humanAgent: true });
    });

    it("Private Reply、Media Share 与 reaction 使用闭合参数", async () => {
        const sendPrivateReply = vi.fn().mockResolvedValue({});
        const send = vi.fn().mockResolvedValue({});
        const react = vi.fn().mockResolvedValue({});
        const client = { sendPrivateReply, send, react } as unknown as InstagramClient;
        await executeInstagramPlatformAction(client, "send_instagram_private_reply", {
            comment_id: "300",
            text: "thanks",
        });
        await executeInstagramPlatformAction(client, "send_instagram_media_share", {
            recipient_id: "200",
            media_id: "400",
        });
        await executeInstagramPlatformAction(client, "react_instagram_message", {
            recipient_id: "200",
            message_id: "m1",
            action: "unreact",
        });
        expect(sendPrivateReply).toHaveBeenCalledWith("300", "thanks");
        expect(send).toHaveBeenCalledWith("200", {
            attachment: { type: "MEDIA_SHARE", payload: { id: "400" } },
        });
        expect(react).toHaveBeenCalledWith("200", "m1", "unreact");
    });

    it("Welcome Flow 强制 Instagram eligible platform，并验证更新语义", async () => {
        const call = vi.fn().mockResolvedValue({ flow_id: "f1" });
        const client = {
            config: { instagram_user_id: "100" },
            call,
        } as unknown as InstagramClient;
        await executeInstagramPlatformAction(client, "create_instagram_welcome_message_flow", {
            flow: {
                name: "Welcome",
                welcome_message_flow: [{ message: { text: "Hello" } }],
                eligible_platforms: ["messenger"],
            },
        });
        expect(call).toHaveBeenCalledWith("POST", "/100/welcome_message_flows", {
            body: {
                name: "Welcome",
                welcome_message_flow: [{ message: { text: "Hello" } }],
                eligible_platforms: ["instagram"],
            },
        });
        await expect(
            executeInstagramPlatformAction(client, "update_instagram_welcome_message_flow", {
                flow_id: "f1",
                flow: {
                    name: "Update",
                    welcome_message_flow: [{ message: { text: "Hi" } }],
                    eligible_platforms: ["instagram"],
                },
            }),
        ).rejects.toThrow(/eligible_platforms/u);
    });

    it("Messenger Profile 固定 Instagram platform，并闭合 Menu/Ice Breaker 结构", async () => {
        const call = vi.fn().mockResolvedValue({ result: "success" });
        const client = {
            config: { instagram_user_id: "100" },
            call,
        } as unknown as InstagramClient;
        await executeInstagramPlatformAction(client, "set_instagram_messenger_profile", {
            profile: {
                persistent_menu: [
                    {
                        locale: "default",
                        call_to_actions: [
                            { type: "postback", title: "Help", payload: "HELP" },
                            {
                                type: "web_url",
                                title: "Shop",
                                url: "https://shop.example/",
                            },
                        ],
                    },
                ],
                ice_breakers: [{ question: "Need help?", payload: "HELP" }],
            },
        });
        expect(call).toHaveBeenCalledWith("POST", "/100/messenger_profile", {
            body: expect.objectContaining({ platform: "instagram" }),
        });
        await expect(
            executeInstagramPlatformAction(client, "get_instagram_messenger_profile", {
                fields: ["future_field"],
            }),
        ).rejects.toThrow(/persistent_menu/u);
        await expect(
            executeInstagramPlatformAction(client, "set_instagram_messenger_profile", {
                profile: { composer_input_disabled: true },
            }),
        ).rejects.toThrow(/不接受字段/u);
    });

    it("通用 Graph 调用拒绝不安全方法与不可克隆 body", async () => {
        const client = { call: vi.fn() } as unknown as InstagramClient;
        await expect(
            executeInstagramPlatformAction(client, "call_instagram_api", {
                method: "PATCH",
                path: "/me",
            }),
        ).rejects.toThrow(/GET、POST 或 DELETE/u);
        await expect(
            executeInstagramPlatformAction(client, "call_instagram_api", {
                method: "POST",
                path: "/me",
                body: { callback: () => undefined },
            }),
        ).rejects.toThrow(/结构化克隆/u);
        await expect(
            executeInstagramPlatformAction(client, "call_instagram_api", {
                method: "GET",
                path: "/me",
                typo: true,
            }),
        ).rejects.toThrow(/不接受参数 typo/u);
    });
});
