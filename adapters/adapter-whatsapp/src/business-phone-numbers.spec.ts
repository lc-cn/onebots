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

const phoneNumber = {
    id: "1906385232743451",
    display_phone_number: "+1 631-555-5555",
    verified_name: "OneBots",
    status: "LINKED",
    quality_rating: "GREEN",
    country_code: "US",
    country_dial_code: "1",
    code_verification_status: "VERIFIED",
    unified_cert_status: "APPROVED",
    account_mode: "LIVE",
    host_platform: "CLOUD_API",
    messaging_limit_tier: "TIER_1K",
    is_official_business_account: true,
    username: null,
};

describe("WhatsAppBusinessPhoneNumbers", () => {
    it("以受控字段、过滤器、排序和 cursor 查询 WABA 号码资产", async () => {
        const fetcher = jsonFetcher({
            data: [phoneNumber],
            paging: {
                cursors: { after: "next-cursor" },
                next: "https://graph.facebook.com/v23.0/123456/phone_numbers?after=next-cursor",
            },
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.businessPhoneNumbers.list({
                fields: [
                    "verified_name",
                    "quality_rating",
                    "country_code",
                    "country_dial_code",
                    "code_verification_status",
                    "unified_cert_status",
                    "account_mode",
                    "host_platform",
                    "messaging_limit_tier",
                    "is_official_business_account",
                    "username",
                ],
                filters: [
                    { field: "account_mode", operator: "EQUAL", value: "LIVE" },
                    {
                        field: "is_official_business_account",
                        operator: "EQUAL",
                        value: true,
                    },
                ],
                sort: "last_onboarded_time.desc",
                limit: 50,
                after: "cursor",
            }),
        ).resolves.toEqual({
            data: [phoneNumber],
            paging: {
                cursors: { after: "next-cursor" },
                next: "https://graph.facebook.com/v23.0/123456/phone_numbers?after=next-cursor",
            },
        });
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe("/v23.0/123456/phone_numbers");
        expect(url.searchParams.get("fields")).toContain("id,display_phone_number,status");
        expect(JSON.parse(url.searchParams.get("filtering") || "null")).toEqual([
            { field: "account_mode", operator: "EQUAL", value: "LIVE" },
            { field: "is_official_business_account", operator: "EQUAL", value: true },
        ]);
        expect(url.searchParams.get("sort")).toBe("last_onboarded_time.desc");
        expect(url.searchParams.get("limit")).toBe("50");
    });

    it("接受仅包含官方必填字段的稀疏号码响应", async () => {
        const sparse = {
            id: "1906385232743451",
            display_phone_number: "+1 631-555-5555",
            status: "PENDING",
        };
        const client = new WhatsAppClient(config, jsonFetcher({ data: [sparse] }));
        await expect(client.businessPhoneNumbers.list()).resolves.toEqual({ data: [sparse] });
    });

    it("创建 WABA 号码入驻并保留迁移与预验证字段", async () => {
        const fetcher = jsonFetcher({ id: "1906385232743451" });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            executeWhatsAppPlatformAction(client, "create_business_phone_number", {
                request: {
                    phone_number: "16315551000",
                    verified_name: "OneBots Gateway",
                    cc: "1",
                    migrate_phone_number: false,
                    preverified_id: "preverified_12345",
                },
            }),
        ).resolves.toEqual({ id: "1906385232743451" });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(requestJson(fetcher)).toEqual({
            phone_number: "16315551000",
            verified_name: "OneBots Gateway",
            cc: "1",
            migrate_phone_number: false,
            preverified_id: "preverified_12345",
        });
    });

    it("号码资产动作拒绝契约外顶层字段并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "list_business_phone_numbers", { limit: 10 }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "list_business_phone_numbers", parameter: "limit" },
        });
    });

    it.each([
        ["空字段", "list_business_phone_numbers", { query: { fields: [] } }],
        ["未知字段", "list_business_phone_numbers", { query: { fields: ["token"] } }],
        ["越界 limit", "list_business_phone_numbers", { query: { limit: 101 } }],
        ["双向 cursor", "list_business_phone_numbers", { query: { after: "a", before: "b" } }],
        [
            "重复 filter",
            "list_business_phone_numbers",
            {
                query: {
                    filters: [
                        { field: "account_mode", operator: "EQUAL", value: "LIVE" },
                        { field: "account_mode", operator: "EQUAL", value: "SANDBOX" },
                    ],
                },
            },
        ],
        [
            "未知 filter operator",
            "list_business_phone_numbers",
            { query: { filters: [{ field: "account_mode", operator: "IN", value: "LIVE" }] } },
        ],
        [
            "非法 E.164",
            "create_business_phone_number",
            { request: { phone_number: "+16315551000", verified_name: "OneBots" } },
        ],
        [
            "过短 verified_name",
            "create_business_phone_number",
            { request: { phone_number: "16315551000", verified_name: "O" } },
        ],
        [
            "cc 不匹配",
            "create_business_phone_number",
            { request: { phone_number: "16315551000", verified_name: "OneBots", cc: "44" } },
        ],
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
                    id: "1906385232743451",
                    display_phone_number: "+1 631-555-5555",
                    status: "UNKNOWN",
                },
            ],
        },
        { data: [], paging: { next: "http://graph.facebook.com/next" } },
        { id: "not-numeric" },
    ])("拒绝畸形号码资产响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "id" in response
                ? client.businessPhoneNumbers.create({
                      phone_number: "16315551000",
                      verified_name: "OneBots",
                  })
                : client.businessPhoneNumbers.list();
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
