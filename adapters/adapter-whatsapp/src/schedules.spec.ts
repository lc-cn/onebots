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

const schedule = {
    id: "987654",
    name: "Business Hours",
    status: "ACTIVE",
    schedule_type: "BUSINESS_HOURS",
    description: "Weekday support",
    start_time: "09:00",
    end_time: "17:00",
    timezone: "America/New_York",
    days_of_week: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    created_time: "2026-08-01T00:00:00Z",
    updated_time: "2026-08-30T00:00:00Z",
    is_active: true,
    recurrence_pattern: { frequency: "WEEKLY", interval: 1, end_date: "2026-12-31" },
};

describe("WhatsAppSchedules", () => {
    it("以受控字段、过滤器、排序和 cursor 查询 WABA Schedule", async () => {
        const fetcher = jsonFetcher({
            data: [schedule],
            paging: {
                cursors: { after: "next-cursor" },
                next: "https://graph.facebook.com/v23.0/123456/schedules?after=next-cursor",
            },
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.schedules.list({
                fields: [
                    "description",
                    "start_time",
                    "end_time",
                    "timezone",
                    "days_of_week",
                    "created_time",
                    "updated_time",
                    "is_active",
                    "recurrence_pattern",
                ],
                filters: [
                    { field: "status", operator: "EQUAL", value: "ACTIVE" },
                    { field: "schedule_type", operator: "EQUAL", value: "BUSINESS_HOURS" },
                ],
                sort: "updated_time.desc",
                limit: 50,
                after: "cursor",
            }),
        ).resolves.toEqual({
            data: [schedule],
            paging: {
                cursors: { after: "next-cursor" },
                next: "https://graph.facebook.com/v23.0/123456/schedules?after=next-cursor",
            },
        });
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe("/v23.0/123456/schedules");
        expect(url.searchParams.get("fields")).toContain("id,name,status,schedule_type");
        expect(JSON.parse(url.searchParams.get("filtering") || "null")).toEqual([
            { field: "status", operator: "EQUAL", value: "ACTIVE" },
            { field: "schedule_type", operator: "EQUAL", value: "BUSINESS_HOURS" },
        ]);
        expect(url.searchParams.get("sort")).toBe("updated_time.desc");
    });

    it("创建业务时段并校验 IANA 时区、星期和 recurrence", async () => {
        const fetcher = jsonFetcher({ id: "987654" });
        const client = new WhatsAppClient(config, fetcher);
        const request = {
            name: "Business Hours",
            schedule_type: "BUSINESS_HOURS" as const,
            description: "Weekday support",
            start_time: "09:00",
            end_time: "17:00",
            timezone: "America/New_York",
            days_of_week: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const,
            is_active: true,
            recurrence_pattern: {
                frequency: "WEEKLY" as const,
                interval: 1,
                end_date: "2026-12-31",
            },
        };

        await expect(client.schedules.create(request)).resolves.toEqual({ id: "987654" });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(requestJson(fetcher)).toEqual(request);
    });

    it("按官方夜间示例允许跨午夜 Schedule", async () => {
        const fetcher = jsonFetcher({ id: "987654" });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "create_business_schedule", {
                request: {
                    name: "After Hours",
                    schedule_type: "AUTOMATED_RESPONSE",
                    start_time: "18:00",
                    end_time: "08:00",
                    timezone: "UTC",
                },
            }),
        ).resolves.toEqual({ id: "987654" });
        expect(requestJson(fetcher)).toMatchObject({ timezone: "UTC", is_active: true });
    });

    it("接受仅包含官方必填字段的稀疏 Schedule", async () => {
        const sparse = {
            id: "987654",
            name: "Draft",
            status: "DRAFT",
            schedule_type: "CUSTOM",
        };
        const client = new WhatsAppClient(config, jsonFetcher({ data: [sparse] }));
        await expect(client.schedules.list()).resolves.toEqual({ data: [sparse] });
    });

    it("Schedule 动作拒绝契约外顶层字段并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "list_business_schedules", { limit: 10 }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "list_business_schedules", parameter: "limit" },
        });
    });

    it.each([
        ["空字段", "list_business_schedules", { query: { fields: [] } }],
        ["未知字段", "list_business_schedules", { query: { fields: ["token"] } }],
        ["越界 limit", "list_business_schedules", { query: { limit: 101 } }],
        ["双向 cursor", "list_business_schedules", { query: { after: "a", before: "b" } }],
        [
            "重复 filter",
            "list_business_schedules",
            {
                query: {
                    filters: [
                        { field: "status", operator: "EQUAL", value: "ACTIVE" },
                        { field: "status", operator: "EQUAL", value: "DRAFT" },
                    ],
                },
            },
        ],
        [
            "相同起止时间",
            "create_business_schedule",
            {
                request: {
                    name: "Invalid",
                    schedule_type: "CUSTOM",
                    start_time: "09:00",
                    end_time: "09:00",
                },
            },
        ],
        [
            "非法时钟",
            "create_business_schedule",
            {
                request: {
                    name: "Invalid",
                    schedule_type: "CUSTOM",
                    start_time: "24:00",
                    end_time: "09:00",
                },
            },
        ],
        [
            "非法时区",
            "create_business_schedule",
            {
                request: {
                    name: "Invalid",
                    schedule_type: "CUSTOM",
                    start_time: "08:00",
                    end_time: "09:00",
                    timezone: "Mars/Olympus",
                },
            },
        ],
        [
            "重复星期",
            "create_business_schedule",
            {
                request: {
                    name: "Invalid",
                    schedule_type: "CUSTOM",
                    start_time: "08:00",
                    end_time: "09:00",
                    days_of_week: ["MONDAY", "MONDAY"],
                },
            },
        ],
        [
            "非法 recurrence 日期",
            "create_business_schedule",
            {
                request: {
                    name: "Invalid",
                    schedule_type: "CUSTOM",
                    start_time: "08:00",
                    end_time: "09:00",
                    recurrence_pattern: { end_date: "2026-02-30" },
                },
            },
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
        { data: [{ id: "987654", name: "Draft", status: "UNKNOWN", schedule_type: "CUSTOM" }] },
        {
            data: [
                {
                    id: "987654",
                    name: "Draft",
                    status: "DRAFT",
                    schedule_type: "CUSTOM",
                    timezone: "Mars/Olympus",
                },
            ],
        },
        { data: [], paging: { next: "http://graph.facebook.com/next" } },
        { id: "not-numeric" },
    ])("拒绝畸形 Schedule 响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "id" in response
                ? client.schedules.create({
                      name: "Schedule",
                      schedule_type: "CUSTOM",
                      start_time: "08:00",
                      end_time: "09:00",
                  })
                : client.schedules.list();
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
