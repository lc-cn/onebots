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

const settingsResponse = {
    calling: {
        status: "enabled",
        call_icon_visibility: "visible",
        ip_addresses: { default: ["157.240.0.1"] },
        callback_permission_status: "enabled",
        srtp_key_exchange_protocol: "DTLS-SRTP",
        sip: {
            status: "enabled",
            servers: [
                {
                    app_id: "app-1",
                    hostname: "sip.whatsapp.com",
                    port: 5060,
                    password: "credential",
                },
            ],
        },
        video: { status: "enabled" },
    },
    payload_encryption: {
        status: "enabled",
        client_encryption_key_fingerprint: "SHA256:fingerprint",
        cloud_encryption_key: "cloud-key",
    },
    storage_configuration: {
        status: "in_country_storage_enabled",
        data_localization_region: "us",
    },
};

describe("WhatsApp Phone Number Settings", () => {
    it("读取并验证 Calling、SIP、加密与存储设置", async () => {
        const fetcher = jsonFetcher(settingsResponse);
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.settings.get(true)).resolves.toEqual(settingsResponse);

        const url = new URL(requestUrl(fetcher));
        expect(`${url.origin}${url.pathname}`).toBe(
            "https://graph.facebook.com/v23.0/phone/settings",
        );
        expect(url.searchParams.get("include_sip_credentials")).toBe("true");
    });

    it("每次只更新一个 Calling feature", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await client.settings.updateCalling({
            status: "enabled",
            call_icon_visibility: "visible",
            video: { status: "enabled" },
            sip: { status: "enabled" },
            srtp_key_exchange_protocol: "DTLS-SRTP",
        });

        expect(requestJson(fetcher)).toEqual({
            calling: {
                status: "enabled",
                call_icon_visibility: "visible",
                video: { status: "enabled" },
                sip: { status: "enabled" },
                srtp_key_exchange_protocol: "DTLS-SRTP",
            },
        });
    });

    it("启用和关闭 payload encryption 使用互斥载荷", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await client.settings.updatePayloadEncryption({
            status: "enabled",
            client_encryption_key: "base64-public-key",
        });
        expect(requestJson(fetcher, 0)).toEqual({
            payload_encryption: {
                status: "enabled",
                client_encryption_key: "base64-public-key",
            },
        });

        await client.settings.updatePayloadEncryption({ status: "disabled" });
        expect(requestJson(fetcher, 1)).toEqual({
            payload_encryption: { status: "disabled" },
        });
    });

    it("更新身份变化通知与数据驻留", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await client.settings.updateUserIdentityChange(true);
        expect(requestJson(fetcher, 0)).toEqual({ user_identity_change: { enabled: true } });

        await client.settings.updateStorage({ enabled: true, region: "us" });
        expect(requestJson(fetcher, 1)).toEqual({
            storage_configuration: { enabled: true, region: "us" },
        });
    });

    it("固定平台动作不接受混合 feature JSON", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await executeWhatsAppPlatformAction(client, "update_storage_configuration_settings", {
            storage_configuration: { enabled: false },
            payload_encryption: { status: "disabled" },
        });

        expect(requestJson(fetcher)).toEqual({ storage_configuration: { enabled: false } });
    });

    it("拒绝不闭合的更新和畸形响应", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            client.settings.updatePayloadEncryption({
                status: "enabled",
                client_encryption_key: "",
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
        await expect(
            client.settings.updateStorage({ enabled: true, region: "" }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });

        const invalid = new WhatsAppClient(config, jsonFetcher({ calling: {} }));
        await expect(invalid.settings.get()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function jsonFetcher(payload: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => response(payload));
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
