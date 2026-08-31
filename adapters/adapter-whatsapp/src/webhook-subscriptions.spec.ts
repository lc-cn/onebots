import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    business_account_id: "123456",
    phone_number_id: "phone",
    access_token: "token",
    api_version: "v23.0",
    receive_mode: "manual",
};

const subscription = {
    whatsapp_business_api_data: {
        id: "987654",
        name: "OneBots",
        link: "https://www.facebook.com/games/?app_id=987654",
    },
    override_callback_uri: "https://bots.example/webhook",
};

describe("WhatsAppWebhookSubscriptions", () => {
    it("按受控字段列出 WABA 已订阅 App，并始终保留实体 ID", async () => {
        const fetcher = jsonFetcher({ data: [subscription] });
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.webhookSubscriptions.list(["name", "link", "name"])).resolves.toEqual({
            data: [subscription],
        });
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe("/v23.0/123456/subscribed_apps");
        expect(url.searchParams.get("fields")).toBe("id,name,link");
    });

    it("订阅当前 App 并支持独立 HTTPS callback", async () => {
        const fetcher = jsonFetcher({ success: true, data: [subscription] });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "subscribe_waba_webhooks", {
                subscription: {
                    override_callback_uri: "https://bots.example/webhook",
                    verify_token: "secret",
                },
            }),
        ).resolves.toEqual({ success: true, data: [subscription] });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(requestJson(fetcher)).toEqual({
            override_callback_uri: "https://bots.example/webhook",
            verify_token: "secret",
        });
    });

    it("允许使用 App 默认 Webhook 配置订阅", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.webhookSubscriptions.subscribe()).resolves.toEqual({ success: true });
        expect(requestJson(fetcher)).toEqual({});
    });

    it("取消订阅使用 DELETE 且不发送请求体", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "unsubscribe_waba_webhooks", {}),
        ).resolves.toEqual({ success: true });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("DELETE");
        expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
    });

    it("取消订阅拒绝契约外参数并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "unsubscribe_waba_webhooks", { force: true }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "unsubscribe_waba_webhooks", parameter: "force" },
        });
    });

    it.each([
        ["空字段", "list_webhook_subscriptions", { fields: [] }],
        ["未知字段", "list_webhook_subscriptions", { fields: ["token"] }],
        [
            "非 HTTPS callback",
            "subscribe_waba_webhooks",
            { subscription: { override_callback_uri: "http://bots.example/webhook" } },
        ],
        [
            "带凭据 callback",
            "subscribe_waba_webhooks",
            { subscription: { override_callback_uri: "https://user:pass@bots.example/webhook" } },
        ],
        ["未知订阅字段", "subscribe_waba_webhooks", { subscription: { fields: [] } }],
    ])("拒绝%s", async (_label, action, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it.each([
        {},
        { data: [{}] },
        {
            data: [
                {
                    whatsapp_business_api_data: {
                        id: "app",
                        name: "OneBots",
                        link: "https://example.com",
                    },
                },
            ],
        },
        { success: false },
        { success: true, data: {} },
    ])("拒绝畸形响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "success" in response
                ? client.webhookSubscriptions.subscribe()
                : client.webhookSubscriptions.list();
        await expect(operation).rejects.toMatchObject({ code: "WHATSAPP_INVALID_RESPONSE" });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function requestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): URL {
    return new URL(String(fetcher.mock.calls[0]?.[0]));
}

function requestJson(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
    return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
}
