import { createHmac } from "node:crypto";
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

    it.each(["/phone", "phone?fields=id", "phone#token", "phone/../me", "phone/%2e%2e/me"])(
        "拒绝夹带 URL 语义的 resource: %s",
        async resource => {
            const client = new WhatsAppClient(config);
            await expect(client.call({ resource })).rejects.toMatchObject({
                code: "WHATSAPP_INVALID_RESOURCE",
            });
        },
    );

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
        expect(client.ingest(event)).toMatchObject({
            accepted: 2,
            duplicate: false,
            changes: 1,
            messages: 1,
            statuses: 1,
        });
        expect(raw).toHaveBeenCalledWith(event);
        expect(message).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledTimes(1);
        expect(client.getObservedContact("1")).toBeUndefined();
    });

    it("只记录 Webhook 实际提供的联系人资料", () => {
        const client = new WhatsAppClient(config);
        const observedDuringDispatch = vi.fn();
        client.on("webhook", () => {
            observedDuringDispatch(client.getObservedContact("86123"));
        });
        client.ingest({
            object: "whatsapp_business_account",
            entry: [
                {
                    id: "waba",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                contacts: [{ profile: { name: "Alice" }, wa_id: "86123" }],
                            },
                        },
                    ],
                },
            ],
        });
        expect(client.getObservedContact("86123")).toEqual({ id: "86123", name: "Alice" });
        expect(client.getObservedContact("unknown")).toBeUndefined();
        expect(observedDuringDispatch).toHaveBeenCalledWith({ id: "86123", name: "Alice" });
    });

    it("manual 模式无需 Webhook 凭据并拒绝重复原始事件", () => {
        const client = new WhatsAppClient({
            ...config,
            receive_mode: "manual",
            app_secret: undefined,
            webhook_verify_token: undefined,
        });
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [{ id: "waba", changes: [] }],
        };
        expect(client.ingest(event).duplicate).toBe(false);
        expect(client.ingest(event).duplicate).toBe(true);
    });

    it("业务监听器失败时不提交去重状态，允许 Meta 重投递", () => {
        const client = new WhatsAppClient({ ...config, receive_mode: "manual" });
        const event = {
            object: "whatsapp_business_account" as const,
            entry: [{ id: "waba", changes: [] }],
        };
        const failure = (): void => {
            throw new Error("downstream failed");
        };
        client.on("webhook", failure);
        expect(() => client.ingest(event)).toThrow("downstream failed");
        client.off("webhook", failure);
        expect(client.ingest(event).duplicate).toBe(false);
    });

    it("acceptHttp 接收标准 Request 并返回结构化响应", async () => {
        const client = new WhatsAppClient(config);
        const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
        const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
        const response = await client.acceptHttp(
            new Request("https://example.test/whatsapp", {
                method: "POST",
                body,
                headers: { "x-hub-signature-256": signature },
            }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            ok: true,
            accepted: 0,
            duplicate: false,
            changes: 0,
        });
        const verification = await client.acceptHttp(
            new Request(
                "https://example.test/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=42",
            ),
        );
        expect(verification.status).toBe(200);
        expect(await verification.text()).toBe("42");
    });

    it("严格拒绝带凭据、路径或查询的 Graph API Base URL", () => {
        for (const apiBaseUrl of [
            "https://user:pass@graph.facebook.com",
            "https://graph.facebook.com/custom",
            "https://graph.facebook.com?token=x",
        ]) {
            expect(() => new WhatsAppClient({ ...config, api_base_url: apiBaseUrl })).toThrow(
                /HTTPS Origin/u,
            );
        }
    });
});
