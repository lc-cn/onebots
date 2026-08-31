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

const status = {
    id: "654321",
    oba_status: "UNDER_REVIEW",
    status_message: "Your Official Business Account application is under review",
};

describe("WhatsAppOfficialBusinessAccount", () => {
    it("读取当前 Phone Number 的 OBA 状态", async () => {
        const fetcher = jsonFetcher(status);
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.officialBusinessAccount.getStatus()).resolves.toEqual(status);
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe("/v23.0/654321/official_business_account");
        expect(url.searchParams.get("fields")).toBe("oba_status,status_message");
    });

    it("按正式 Schema 提交 OBA 申请", async () => {
        const response = {
            success: true,
            message: "Official Business Account application submitted successfully",
            updated_status: status,
            tracking_id: "oba_req_123",
        };
        const fetcher = jsonFetcher(response);
        const client = new WhatsAppClient(config, fetcher);
        const application = {
            business_website_url: "https://example.com",
            primary_country_of_operation: "ph",
            primary_language: "en_PH",
            parent_business_or_brand: "OneBots",
            supporting_links: [
                "https://news.example.com/1",
                "https://news.example.com/2",
                "https://news.example.com/3",
                "https://news.example.com/4",
                "https://news.example.com/5",
            ],
            additional_supporting_information: "Publicly recognized messaging platform",
        };

        await expect(
            client.officialBusinessAccount.submitApplication(application),
        ).resolves.toEqual(response);
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(requestJson(fetcher)).toEqual({
            ...application,
            business_website_url: "https://example.com/",
            primary_country_of_operation: "PH",
        });
    });

    it("通过固定平台动作访问 OBA 能力", async () => {
        const client = new WhatsAppClient(config, jsonFetcher(status));
        await expect(
            executeWhatsAppPlatformAction(client, "get_official_business_account_status", {}),
        ).resolves.toEqual(status);
    });

    it("OBA 动作拒绝契约外顶层字段并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "get_official_business_account_status", {
                fields: ["oba_status"],
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: {
                action: "get_official_business_account_status",
                parameter: "fields",
            },
        });
    });

    it.each([
        ["缺少申请", {}],
        [
            "示例中不存在于 Schema 的 action",
            {
                application: {
                    action: "SUBMIT_APPLICATION",
                    business_website_url: "https://example.com",
                    primary_country_of_operation: "PH",
                },
            },
        ],
        [
            "非 HTTPS 官网",
            {
                application: {
                    business_website_url: "http://example.com",
                    primary_country_of_operation: "PH",
                },
            },
        ],
        [
            "带凭据官网",
            {
                application: {
                    business_website_url: "https://user:secret@example.com",
                    primary_country_of_operation: "PH",
                },
            },
        ],
        [
            "非法国家码",
            {
                application: {
                    business_website_url: "https://example.com",
                    primary_country_of_operation: "PHL",
                },
            },
        ],
        [
            "不足五条佐证链接",
            {
                application: {
                    business_website_url: "https://example.com",
                    primary_country_of_operation: "PH",
                    supporting_links: ["https://news.example.com/1"],
                },
            },
        ],
        [
            "重复佐证链接",
            {
                application: {
                    business_website_url: "https://example.com",
                    primary_country_of_operation: "PH",
                    supporting_links: Array.from(
                        { length: 5 },
                        () => "https://news.example.com/same",
                    ),
                },
            },
        ],
    ])("拒绝%s", async (_label, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(
                client,
                "submit_official_business_account_application",
                params,
            ),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it.each([
        {},
        { id: "654321", oba_status: "UNKNOWN", status_message: "Unknown" },
        { id: "654321", oba_status: "APPROVED", status_message: "" },
        { success: "true", message: "Submitted" },
        { success: true, message: "", tracking_id: "oba_req_123" },
        { success: true, message: "Submitted", updated_status: {} },
    ])("拒绝畸形 OBA 响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "success" in response
                ? client.officialBusinessAccount.submitApplication({
                      business_website_url: "https://example.com",
                      primary_country_of_operation: "PH",
                  })
                : client.officialBusinessAccount.getStatus();
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
