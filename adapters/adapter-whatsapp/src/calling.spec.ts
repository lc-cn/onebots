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

describe("WhatsApp Calling API", () => {
    it("查询并验证用户呼叫权限", async () => {
        const fetcher = jsonFetcher({
            messaging_product: "whatsapp",
            permission: { status: "granted", expiration_time: 1735689600 },
            actions: [
                {
                    action_name: "start_call",
                    can_perform_action: true,
                    limits: [
                        {
                            time_period: "24h",
                            current_usage: 1,
                            max_allowed: 5,
                            limit_expiration_time: 1735689600,
                        },
                    ],
                },
            ],
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.calling.getPermission("8613800138000")).resolves.toMatchObject({
            permission: { status: "granted" },
        });
        const url = new URL(requestUrl(fetcher));
        expect(`${url.origin}${url.pathname}`).toBe(
            "https://graph.facebook.com/v23.0/phone/call_permissions",
        );
        expect(url.searchParams.get("user_wa_id")).toBe("8613800138000");
    });

    it("通过 messages 发送 call_permission_request", async () => {
        const fetcher = jsonFetcher({
            messaging_product: "whatsapp",
            messages: [{ id: "wamid.permission" }],
        });
        const client = new WhatsAppClient(config, fetcher);

        await client.calling.requestPermission("8613800138000");

        expect(requestUrl(fetcher)).toBe("https://graph.facebook.com/v23.0/phone/messages");
        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: "8613800138000",
            type: "interactive",
            interactive: {
                type: "call_permission_request",
                action: { name: "call_permission_request" },
            },
        });
    });

    it("connect 固定 offer SDP 并保留回调标识", async () => {
        const fetcher = jsonFetcher({
            messaging_product: "whatsapp",
            calls: [{ id: "wacid.call" }],
        });
        const client = new WhatsAppClient(config, fetcher);

        await client.calling.connect({
            to: "8613800138000",
            session: { sdp_type: "offer", sdp: "v=0\r\n" },
            biz_opaque_callback_data: "trace-1",
        });

        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            action: "connect",
            to: "8613800138000",
            session: { sdp_type: "offer", sdp: "v=0\r\n" },
            biz_opaque_callback_data: "trace-1",
        });
    });

    it("accept 使用 answer，terminate 使用 call_id", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                response({ messaging_product: "whatsapp", calls: [{ id: "wacid.call" }] }),
            )
            .mockResolvedValueOnce(response({ success: true }));
        const client = new WhatsAppClient(config, fetcher);

        await client.calling.accept("8613800138000", {
            sdp_type: "answer",
            sdp: "v=0\r\n",
        });
        expect(requestJson(fetcher, 0)).toMatchObject({
            action: "accept",
            to: "8613800138000",
            session: { sdp_type: "answer" },
        });

        await client.calling.terminate("wacid.call");
        expect(requestJson(fetcher, 1)).toEqual({
            messaging_product: "whatsapp",
            call_id: "wacid.call",
            action: "terminate",
        });
    });

    it("固定平台动作复用 Calling 深模块", async () => {
        const fetcher = jsonFetcher({
            messaging_product: "whatsapp",
            calls: [{ id: "wacid.call" }],
        });
        const client = new WhatsAppClient(config, fetcher);

        await executeWhatsAppPlatformAction(client, "reject_call", {
            user_id: "8613800138000",
        });

        expect(requestJson(fetcher)).toMatchObject({ action: "reject", to: "8613800138000" });
    });

    it("Calling 动作拒绝契约外字段并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "connect_call", {
                user_id: "8613800138000",
                sdp: "v=0\r\n",
                sdp_type: "offer",
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "connect_call", parameter: "sdp_type" },
        });
    });

    it("拒绝错误状态、错误响应和超长回调标识", async () => {
        const invalidPermission = new WhatsAppClient(
            config,
            jsonFetcher({ messaging_product: "whatsapp", permission: { status: "unknown" } }),
        );
        await expect(invalidPermission.calling.getPermission("86123")).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });

        const invalidCall = new WhatsAppClient(config, jsonFetcher({ calls: [] }));
        await expect(invalidCall.calling.reject("86123")).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });

        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            client.calling.connect({
                to: "86123",
                session: { sdp_type: "offer", sdp: "v=0" },
                biz_opaque_callback_data: "x".repeat(513),
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });
});

function jsonFetcher(payload: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockResolvedValue(response(payload));
}

function response(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
    });
}

function requestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): string {
    return String(fetcher.mock.calls[0]?.[0]);
}

function requestJson(
    fetcher: ReturnType<typeof vi.fn<typeof fetch>>,
    index = 0,
): Record<string, unknown> {
    return JSON.parse(String(fetcher.mock.calls[index]?.[1]?.body)) as Record<string, unknown>;
}
