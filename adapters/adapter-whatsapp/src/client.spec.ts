import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
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

describe("WhatsAppClient", () => {
    it("使用版本化 Graph API 路径并携带 Bearer Token", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ id: "phone" }), {
                headers: { "content-type": "application/json" },
            }),
        );
        const client = new WhatsAppClient(config, fetcher);
        await client.getPhoneNumberInfo();
        const [url, request] = fetcher.mock.calls[0] || [];
        expect(String(url)).toContain("/v23.0/phone?fields=");
        expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer token");
    });

    it("拒绝绝对 URL，避免访问令牌发送到非配置域名", async () => {
        const client = new WhatsAppClient(config);
        await expect(client.call({ resource: "https://evil.example/me" })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESOURCE",
        } satisfies Partial<WhatsAppApiError>);
    });

    it("允许 Graph API 的 upload: 资源 ID", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ id: "upload:session" }), {
                headers: { "content-type": "application/json" },
            }),
        );
        const client = new WhatsAppClient(config, fetcher);
        await client.call({ resource: "upload:session" });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("/v23.0/upload:session");
    });

    it("保留 Graph API 的结构化错误", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ error: { message: "Denied", code: 10 } }), {
                status: 403,
                headers: { "content-type": "application/json" },
            }),
        );
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.getPhoneNumberInfo()).rejects.toMatchObject({
            code: "WHATSAPP_10",
            status: 403,
            details: { error: { message: "Denied", code: 10 } },
        });
    });

    it("从统一 ingest 入口分发完整 Webhook 与细粒度事件", () => {
        const client = new WhatsAppClient(config);
        const raw = vi.fn();
        const message = vi.fn();
        const status = vi.fn();
        client.on("raw_event", raw);
        client.on("message", message);
        client.on("status", status);
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [
                {
                    id: "waba",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                messages: [
                                    { id: "m1", from: "1", timestamp: "1", type: "text" as const },
                                ],
                                statuses: [
                                    {
                                        id: "m2",
                                        recipient_id: "1",
                                        timestamp: "2",
                                        status: "read" as const,
                                    },
                                ],
                            },
                        },
                    ],
                },
            ],
        };
        expect(client.ingest(event)).toBe(2);
        expect(raw).toHaveBeenCalledWith(event);
        expect(message).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledTimes(1);
    });
});
