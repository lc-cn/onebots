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

describe("WhatsAppCommerce", () => {
    it("读取并校验 Commerce 设置数组", async () => {
        const fetcher = jsonFetcher({
            data: [{ id: "setting", is_cart_enabled: true, is_catalog_visible: false }],
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.commerce.get()).resolves.toEqual({
            data: [{ id: "setting", is_cart_enabled: true, is_catalog_visible: false }],
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("/phone/whatsapp_commerce_settings");
    });

    it("更新时只发送显式设置且保留 false", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.commerce.update({ is_cart_enabled: false })).resolves.toEqual({
            success: true,
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("is_cart_enabled=false");
        expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("is_catalog_visible");
    });

    it("固定平台动作复用强类型模块", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await executeWhatsAppPlatformAction(client, "update_commerce_settings", {
            is_catalog_visible: true,
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("is_catalog_visible=true");
    });

    it.each([
        { label: "空更新", settings: {} },
        { label: "错误布尔类型", settings: { is_cart_enabled: "false" } },
        { label: "未知字段", settings: { is_cart_enabled: true, catalog_id: "catalog" } },
    ])("拒绝非法设置：$label", async ({ settings }) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "update_commerce_settings", settings),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("拒绝畸形读取项与虚假成功响应", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ data: [{ is_cart_enabled: "yes" }] }))
            .mockResolvedValueOnce(Response.json({ success: false }));
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.commerce.get()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
        await expect(client.commerce.update({ is_cart_enabled: true })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}
