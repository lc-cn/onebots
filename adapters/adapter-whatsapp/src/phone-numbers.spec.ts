import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    business_account_id: "waba",
    phone_number_id: "phone",
    access_token: "token",
    api_version: "v23.0",
    receive_mode: "manual",
};

describe("WhatsAppPhoneNumbers", () => {
    it("读取并校验完整号码资料", async () => {
        const fetcher = jsonFetcher({
            id: "phone",
            display_phone_number: "+1 555-555-5555",
            verified_name: "OneBots",
            quality_rating: "GREEN",
            code_verification_status: "VERIFIED",
            name_status: "APPROVED",
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.phoneNumbers.getInfo()).resolves.toMatchObject({
            id: "phone",
            quality_rating: "GREEN",
            code_verification_status: "VERIFIED",
            name_status: "APPROVED",
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("name_status");
    });

    it("注册号码时只发送 PIN 与完整迁移 backup", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await client.phoneNumbers.register({
            pin: "123456",
            backup: { password: "migration-secret", data: "encrypted-backup" },
        });

        expect(String(fetcher.mock.calls[0]?.[0])).toContain("/phone/register");
        expect(bodyAt(fetcher)).toEqual({
            messaging_product: "whatsapp",
            pin: "123456",
            backup: { password: "migration-secret", data: "encrypted-backup" },
        });
    });

    it("注销不发送规范外的 messaging_product body", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.phoneNumbers.deregister()).resolves.toEqual({ success: true });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("/phone/deregister");
        expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
    });

    it("申请并校验号码验证码", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ success: true }))
            .mockResolvedValueOnce(Response.json({ success: true, id: "phone" }));
        const client = new WhatsAppClient(config, fetcher);

        await client.phoneNumbers.requestVerificationCode({
            code_method: "VOICE",
            language: "zh_CN",
        });
        await expect(client.phoneNumbers.verifyCode("654321")).resolves.toEqual({
            success: true,
            id: "phone",
        });

        expect(bodyAt(fetcher, 0)).toEqual({ code_method: "VOICE", language: "zh_CN" });
        expect(bodyAt(fetcher, 1)).toEqual({ code: "654321" });
    });

    it("固定动作拒绝契约外字段并保留动作上下文", async () => {
        const fetcher = vi.fn<typeof fetch>();
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            executeWhatsAppPlatformAction(client, "register_phone_number", {
                pin: "123456",
                data_localization_region: "DE",
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: {
                action: "register_phone_number",
                parameter: "data_localization_region",
            },
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("注册动作拒绝 backup 内的未知字段", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "register_phone_number", {
                pin: "123456",
                backup: { password: "secret", data: "cipher", plaintext: true },
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it.each([
        { label: "注册 PIN", action: "register_phone_number", params: { pin: "12345" } },
        {
            label: "验证码方式",
            action: "request_phone_number_verification_code",
            params: { code_method: "EMAIL", language: "en_US" },
        },
        {
            label: "验证码 locale",
            action: "request_phone_number_verification_code",
            params: { code_method: "SMS", language: "english" },
        },
        { label: "验证码", action: "verify_phone_number_code", params: { code: "abcdef" } },
    ])("拒绝非法 $label", async ({ action, params }) => {
        const fetcher = vi.fn<typeof fetch>();
        const client = new WhatsAppClient(config, fetcher);
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("拒绝号码资料中的未知枚举", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({ id: "phone", quality_rating: "UNKNOWN" }),
        );
        await expect(client.phoneNumbers.getInfo()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });

    it("拒绝失败形状或缺少 ID 的成功响应", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ success: false }))
            .mockResolvedValueOnce(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.phoneNumbers.register({ pin: "123456" })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
        await expect(client.phoneNumbers.verifyCode("123456")).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function bodyAt(fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): unknown {
    return JSON.parse(String(fetcher.mock.calls[index]?.[1]?.body));
}
