import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    business_account_id: "123456",
    phone_number_id: "654321",
    access_token: "token",
    api_version: "v23.0",
    receive_mode: "manual",
};

const response = {
    messaging_product: "whatsapp",
    contacts: [{ input: "16315552222", wa_id: "16315552222" }],
    messages: [{ id: "wamid.123", message_status: "held_for_quality_assessment" }],
    success: true,
};

describe("WhatsAppMarketingMessages", () => {
    it("通过专用端点发送带产品策略的营销模板", async () => {
        const fetcher = jsonFetcher(response);
        const client = new WhatsAppClient(config, fetcher);
        const message = {
            to: "16315552222",
            template: {
                name: "promotional_offer",
                language: { code: "en_US" },
                components: [
                    {
                        type: "body" as const,
                        parameters: [
                            { type: "text", text: "John Doe" },
                            {
                                type: "currency",
                                currency: {
                                    fallback_value: "$25.00",
                                    code: "USD",
                                    amount_1000: 25000,
                                },
                            },
                        ],
                    },
                    {
                        type: "button" as const,
                        sub_type: "quick_reply" as const,
                        index: "0",
                        parameters: [{ type: "payload", payload: "VIEW_OFFER" }],
                    },
                ],
            },
            product_policy: "CLOUD_API_FALLBACK" as const,
            message_activity_sharing: false,
        };

        await expect(client.marketingMessages.send(message)).resolves.toEqual(response);
        expect(requestUrl(fetcher).pathname).toBe("/v23.0/654321/marketing_messages");
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            type: "template",
            ...message,
            template: {
                ...message.template,
                language: { policy: "deterministic", code: "en_US" },
            },
        });
    });

    it("通过固定动作发送最小营销模板", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({
                messaging_product: "whatsapp",
                messages: [{ id: "wamid.123", message_status: "accepted" }],
            }),
        );
        await expect(
            executeWhatsAppPlatformAction(client, "send_marketing_message", {
                message: {
                    to: "16315552222",
                    template: {
                        name: "hello_world",
                        language: { policy: "deterministic", code: "en" },
                    },
                    product_policy: "STRICT",
                    message_activity_sharing: true,
                },
            }),
        ).resolves.toMatchObject({ messages: [{ message_status: "accepted" }] });
    });

    it.each([
        ["缺少 message", {}],
        [
            "调用方覆盖固定产品字段",
            {
                message: {
                    to: "16315552222",
                    type: "text",
                    template: { name: "hello_world", language: { code: "en" } },
                },
            },
        ],
        [
            "非法目标",
            {
                message: {
                    to: "+1 631 555 2222",
                    template: { name: "hello_world", language: { code: "en" } },
                },
            },
        ],
        [
            "非法模板名",
            {
                message: {
                    to: "16315552222",
                    template: { name: "Hello-World", language: { code: "en" } },
                },
            },
        ],
        [
            "非法语言策略",
            {
                message: {
                    to: "16315552222",
                    template: {
                        name: "hello_world",
                        language: { policy: "fallback", code: "en" },
                    },
                },
            },
        ],
        [
            "非法产品策略",
            {
                message: {
                    to: "16315552222",
                    template: { name: "hello_world", language: { code: "en" } },
                    product_policy: "BEST_EFFORT",
                },
            },
        ],
        [
            "非法按钮索引",
            {
                message: {
                    to: "16315552222",
                    template: {
                        name: "hello_world",
                        language: { code: "en" },
                        components: [
                            {
                                type: "button",
                                sub_type: "url",
                                index: "10",
                                parameters: [{ type: "text", text: "offer" }],
                            },
                        ],
                    },
                },
            },
        ],
        [
            "header 携带按钮字段",
            {
                message: {
                    to: "16315552222",
                    template: {
                        name: "hello_world",
                        language: { code: "en" },
                        components: [{ type: "header", index: "0", parameters: [] }],
                    },
                },
            },
        ],
    ])("拒绝%s", async (_label, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "send_marketing_message", params),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("拒绝模板参数循环引用", async () => {
        const parameter: { type: string; value?: unknown } = { type: "text" };
        parameter.value = parameter;
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            client.marketingMessages.send({
                to: "16315552222",
                template: {
                    name: "hello_world",
                    language: { code: "en" },
                    components: [{ type: "body", parameters: [parameter] }],
                },
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it.each([
        {},
        { messaging_product: "messenger", messages: [{ id: "wamid.123" }] },
        { messaging_product: "whatsapp", messages: [] },
        { messaging_product: "whatsapp", messages: [{}] },
        { messaging_product: "whatsapp", messages: [{ id: "wamid.123", message_status: "sent" }] },
        { messaging_product: "whatsapp", messages: [{ id: "wamid.123" }], contacts: [{}] },
        { messaging_product: "whatsapp", messages: [{ id: "wamid.123" }], success: "true" },
    ])("拒绝畸形 Marketing Message 响应 %#", async result => {
        const client = new WhatsAppClient(config, jsonFetcher(result));
        await expect(
            client.marketingMessages.send({
                to: "16315552222",
                template: { name: "hello_world", language: { code: "en" } },
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_RESPONSE" });
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
