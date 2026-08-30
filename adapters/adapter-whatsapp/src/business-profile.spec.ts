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

describe("WhatsAppBusinessProfiles", () => {
    it("按显式字段读取嵌套 Business Profile", async () => {
        const fetcher = jsonFetcher({
            data: [
                {
                    business_profile: {
                        messaging_product: "whatsapp",
                        about: "OneBots",
                        email: "bot@example.com",
                        websites: ["https://onebots.example"],
                        vertical: "PROF_SERVICES",
                    },
                },
            ],
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.businessProfile.get(["about", "email", "websites", "vertical"]),
        ).resolves.toMatchObject({
            data: [
                {
                    business_profile: {
                        messaging_product: "whatsapp",
                        vertical: "PROF_SERVICES",
                    },
                },
            ],
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain(
            "fields=about%2Cemail%2Cwebsites%2Cvertical",
        );
    });

    it("更新时只发送受控字段和固定产品标识", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await client.businessProfile.update({
            about: "OneBots gateway",
            address: "",
            email: "support@example.com",
            websites: ["https://onebots.example", "https://docs.onebots.example"],
            vertical: "PROF_SERVICES",
            profile_picture_handle: "upload:profile-handle",
        });

        expect(bodyAt(fetcher)).toEqual({
            messaging_product: "whatsapp",
            about: "OneBots gateway",
            address: "",
            email: "support@example.com",
            websites: ["https://onebots.example", "https://docs.onebots.example"],
            vertical: "PROF_SERVICES",
            profile_picture_handle: "upload:profile-handle",
        });
    });

    it("平台动作要求字段数组并拒绝未知 profile 字段", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "get_business_profile", {
                fields: "about,email",
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
        await expect(
            executeWhatsAppPlatformAction(client, "update_business_profile", {
                profile: { about: "OneBots", arbitrary: true },
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it.each([
        { label: "空 about", profile: { about: "" } },
        { label: "非法邮箱", profile: { email: "not-an-email" } },
        {
            label: "超过两个网站",
            profile: {
                websites: ["https://one.example", "https://two.example", "https://three.example"],
            },
        },
        { label: "非 HTTP 网站", profile: { websites: ["javascript:alert(1)"] } },
        { label: "未知行业", profile: { vertical: "UNKNOWN" } },
    ])("拒绝非法更新：$label", async ({ profile }) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "update_business_profile", { profile }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("拒绝空更新与虚假成功响应", async () => {
        const client = new WhatsAppClient(config, jsonFetcher({ success: false }));
        await expect(client.businessProfile.update({})).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
        await expect(client.businessProfile.update({ about: "OneBots" })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });

    it("把畸形外部 profile 标记为响应错误", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({
                data: [
                    {
                        business_profile: {
                            messaging_product: "whatsapp",
                            websites: ["javascript:alert(1)"],
                        },
                    },
                ],
            }),
        );
        await expect(client.businessProfile.get()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function bodyAt(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
    return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
}
