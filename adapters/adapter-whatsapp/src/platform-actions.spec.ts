import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    app_secret: "secret",
    business_account_id: "waba",
    phone_number_id: "phone",
    access_token: "token",
    webhook_verify_token: "verify",
    api_version: "v23.0",
};

describe("WhatsApp 平台动作", () => {
    it("注册号码前校验六位 PIN", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "register_phone_number", { pin: "12x" }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("通用调用拒绝无法稳定序列化的 query", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "whatsapp_call", {
                resource: "phone",
                query: { nested: { unsafe: true } },
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("原生消息动作保留完整 payload 并补充固定产品字段", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "m" }] }),
                {
                    headers: { "content-type": "application/json" },
                },
            ),
        );
        const client = new WhatsAppClient(config, fetcher);
        await executeWhatsAppPlatformAction(client, "send_native_message", {
            message: {
                to: "86123",
                type: "template",
                template: { name: "hello", language: { code: "en_US" } },
            },
        });
        const request = fetcher.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toMatchObject({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            type: "template",
            template: { name: "hello" },
        });
    });

    it("使用显式布尔值更新 Commerce 设置", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);
        await executeWhatsAppPlatformAction(client, "update_commerce_settings", {
            is_cart_enabled: false,
            is_catalog_visible: true,
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain(
            "/phone/whatsapp_commerce_settings?is_cart_enabled=false&is_catalog_visible=true",
        );
    });

    it("Commerce 设置不能为空操作", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "update_commerce_settings", {}),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("固定 Flow 动作拒绝路径注入", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "publish_flow", {
                flow_id: "flow/../other",
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("群动作拒绝契约外顶层字段", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "get_group", {
                group_id: "group@g.us",
                groupId: "typo",
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "get_group", parameter: "groupId" },
        });
    });
});
