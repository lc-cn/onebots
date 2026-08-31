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

describe("WhatsAppBusinessAccounts", () => {
    it("按受控字段读取 WABA，并始终保留稳定身份字段", async () => {
        const fetcher = jsonFetcher({
            id: "123456",
            name: "OneBots",
            timezone_id: "1",
            account_review_status: "APPROVED",
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.businessAccount.get(["timezone_id", "account_review_status", "timezone_id"]),
        ).resolves.toEqual({
            id: "123456",
            name: "OneBots",
            timezone_id: "1",
            account_review_status: "APPROVED",
        });
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe("/v23.0/123456");
        expect(url.searchParams.get("fields")).toBe("id,name,timezone_id,account_review_status");
    });

    it("只允许更新 WABA 名称和时区", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            executeWhatsAppPlatformAction(client, "update_business_account", {
                account: { name: "OneBots Gateway", timezone_id: "2" },
            }),
        ).resolves.toEqual({ success: true });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(requestJson(fetcher)).toEqual({ name: "OneBots Gateway", timezone_id: "2" });
    });

    it("接受官方可选 WABA 字段与活动详情缺失", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ id: "123456", name: "OneBots" }))
            .mockResolvedValueOnce(
                Response.json({
                    data: [
                        {
                            id: "789012",
                            activity_type: "ACCOUNT_CREATED",
                            timestamp: "2026-08-30T10:00:00Z",
                            actor_type: "SYSTEM",
                        },
                    ],
                }),
            );
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.businessAccount.get()).resolves.toEqual({
            id: "123456",
            name: "OneBots",
        });
        await expect(client.businessAccount.listActivities()).resolves.toEqual({
            data: [
                {
                    id: "789012",
                    activity_type: "ACCOUNT_CREATED",
                    timestamp: "2026-08-30T10:00:00Z",
                    actor_type: "SYSTEM",
                },
            ],
        });
    });

    it("以受控过滤器查询 WABA 活动审计并保留结构化分页", async () => {
        const activity = {
            id: "789012",
            activity_type: "SECURITY_EVENT",
            timestamp: "2026-08-30T10:00:00Z",
            actor_type: "SYSTEM",
            actor_name: "Meta",
            details: { severity: "high", attempts: 2 },
        };
        const fetcher = jsonFetcher({
            data: [activity],
            paging: {
                cursors: { before: "before", after: "after" },
                next: "https://graph.facebook.com/v23.0/123456/activities?after=after",
            },
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.businessAccount.listActivities({
                fields: ["actor_name", "details"],
                limit: 50,
                after: "cursor",
                since: "2026-08-01T00:00:00Z",
                until: "2026-08-30T23:59:59Z",
                activity_types: ["SECURITY_EVENT", "SECURITY_EVENT"],
            }),
        ).resolves.toEqual({
            data: [activity],
            paging: {
                cursors: { before: "before", after: "after" },
                next: "https://graph.facebook.com/v23.0/123456/activities?after=after",
            },
        });
        const url = requestUrl(fetcher);
        expect(url.searchParams.get("fields")).toBe(
            "id,activity_type,timestamp,actor_type,actor_name,details",
        );
        expect(url.searchParams.get("limit")).toBe("50");
        expect(url.searchParams.get("activity_type")).toBe("SECURITY_EVENT");
    });

    it("WABA 动作拒绝契约外顶层字段并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "list_business_account_activities", {
                limit: 10,
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "list_business_account_activities", parameter: "limit" },
        });
    });

    it.each([
        ["空账户字段", "get_business_account", { fields: [] }],
        ["未知账户字段", "get_business_account", { fields: ["access_token"] }],
        ["空更新", "update_business_account", { account: {} }],
        ["未知更新字段", "update_business_account", { account: { currency: "USD" } }],
        ["过长名称", "update_business_account", { account: { name: "x".repeat(101) } }],
        ["越界 limit", "list_business_account_activities", { query: { limit: 101 } }],
        ["双向 cursor", "list_business_account_activities", { query: { after: "a", before: "b" } }],
        [
            "倒置时间范围",
            "list_business_account_activities",
            { query: { since: "2026-08-30T00:00:00Z", until: "2026-08-01T00:00:00Z" } },
        ],
        [
            "超长时间范围",
            "list_business_account_activities",
            { query: { since: "2026-01-01T00:00:00Z", until: "2026-08-01T00:00:00Z" } },
        ],
        [
            "未知活动类型",
            "list_business_account_activities",
            { query: { activity_types: ["LOGIN"] } },
        ],
    ])("拒绝%s", async (_label, action, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it.each([
        {},
        { id: "not-numeric", name: "OneBots" },
        { id: "123456" },
        { data: {} },
        {
            data: [
                {
                    id: "789012",
                    activity_type: "UNKNOWN",
                    timestamp: "2026-08-30T10:00:00Z",
                    actor_type: "SYSTEM",
                },
            ],
        },
        { success: false },
    ])("拒绝畸形 WABA 响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "success" in response
                ? client.businessAccount.update({ name: "OneBots" })
                : "data" in response
                  ? client.businessAccount.listActivities()
                  : client.businessAccount.get();
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
