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

const validInfo = {
    entity_name: "OneBots Private Limited",
    entity_type: "PRIVATE_COMPANY" as const,
    grievance_officer_details: {
        name: "Compliance Officer",
        email: "compliance@example.com",
        mobile_number: "+8613800138000",
    },
    customer_care_details: {
        email: "support@example.com",
        landline_number: "+861012345678",
    },
};

describe("WhatsAppBusinessCompliance", () => {
    it("按显式字段读取官方合规结构并保留空值", async () => {
        const fetcher = jsonFetcher({
            data: [
                {
                    whatsapp_business_account_id: "waba",
                    messaging_product: "whatsapp",
                    entity_name: null,
                    entity_type: null,
                    entity_type_custom: null,
                    is_registered: false,
                    grievance_officer_details: null,
                    customer_care_details: null,
                },
            ],
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.businessCompliance.get(["entity_name", "is_registered", "entity_name"]),
        ).resolves.toMatchObject({
            data: [{ whatsapp_business_account_id: "waba", entity_name: null }],
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("fields=entity_name%2Cis_registered");
    });

    it("更新时只发送验证后的官方字段", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.businessCompliance.update(validInfo)).resolves.toEqual({
            success: true,
        });
        expect(bodyAt(fetcher)).toEqual({ messaging_product: "whatsapp", ...validInfo });
    });

    it("允许 OTHER 自定义实体与 PARTNERSHIP 注册状态", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await client.businessCompliance.update({
            ...validInfo,
            entity_type: "OTHER",
            entity_type_custom: "Community-owned cooperative",
            is_registered: true,
        });
        await client.businessCompliance.update({
            ...validInfo,
            entity_type: "PARTNERSHIP",
            is_registered: false,
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("平台动作要求字段数组", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "get_business_compliance_info", {
                fields: "entity_name,is_registered",
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("平台动作拒绝契约外顶层字段并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "get_business_compliance_info", {
                fields: ["entity_name"],
                include_contacts: true,
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: {
                action: "get_business_compliance_info",
                parameter: "include_contacts",
            },
        });
    });

    it.each([
        { label: "未知实体类型", info: { ...validInfo, entity_type: "UNKNOWN" } },
        { label: "OTHER 缺少自定义类型", info: { ...validInfo, entity_type: "OTHER" } },
        {
            label: "非 OTHER 携带自定义类型",
            info: { ...validInfo, entity_type_custom: "Unexpected" },
        },
        {
            label: "错误实体使用注册状态",
            info: { ...validInfo, is_registered: true },
        },
        {
            label: "非法联系人号码",
            info: {
                ...validInfo,
                grievance_officer_details: {
                    ...validInfo.grievance_officer_details,
                    mobile_number: "13800138000",
                },
            },
        },
        {
            label: "未知更新字段",
            info: { ...validInfo, arbitrary: true },
        },
        {
            label: "未知联系人字段",
            info: {
                ...validInfo,
                customer_care_details: { ...validInfo.customer_care_details, phone: "+8610" },
            },
        },
    ])("拒绝非法合规资料：$label", async ({ info }) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "update_business_compliance_info", { info }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("把畸形联系人和虚假成功标记为响应错误", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                Response.json({
                    data: [
                        {
                            whatsapp_business_account_id: "waba",
                            customer_care_details: { email: "invalid" },
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(Response.json({ success: false }));
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.businessCompliance.get()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
        await expect(client.businessCompliance.update(validInfo)).rejects.toMatchObject({
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
