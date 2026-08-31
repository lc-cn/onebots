import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    business_account_id: "123456789",
    phone_number_id: "987654321",
    access_token: "token",
    api_version: "v23.0",
    receive_mode: "manual",
};

describe("WhatsAppSolutionMigration", () => {
    it("按官方字段读取迁移意图状态", async () => {
        const fetcher = jsonFetcher({ id: "123456", status: "INITIATED" });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.solutionMigration.get("123456", ["status", "id", "status"]),
        ).resolves.toEqual({
            id: "123456",
            status: "INITIATED",
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain("/v23.0/123456?fields=status%2Cid");
    });

    it("在 WABA 资源设置完整迁移请求", async () => {
        const fetcher = jsonFetcher({
            success: true,
            migration_intent_id: "migration_intent_123",
            status: "SCHEDULED",
            estimated_completion_time: "2027-01-01T08:30:00Z",
        });
        const client = new WhatsAppClient(config, fetcher);
        const request = {
            solution_id: "111",
            migration_intent: "SCHEDULE_MIGRATION" as const,
            target_solution_id: "222",
            migration_reason: "Planned provider migration",
            scheduled_migration_time: "2027-01-01T08:00:00+00:00",
        };

        await expect(client.solutionMigration.set(request)).resolves.toMatchObject({
            migration_intent_id: "migration_intent_123",
            status: "SCHEDULED",
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain(
            "/123456789/set_solution_migration_intent",
        );
        expect(bodyAt(fetcher)).toEqual(request);
    });

    it("固定平台动作拒绝 request 外层字段并保留动作上下文", async () => {
        const fetcher = vi.fn<typeof fetch>();
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "set_solution_migration_intent", {
                request: { solution_id: "111", migration_intent: "CANCEL_MIGRATION" },
                arbitrary: true,
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "set_solution_migration_intent", parameter: "arbitrary" },
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([
        {
            label: "路径 ID 注入",
            action: "get_migration_intent",
            params: { migration_intent_id: "123/fields" },
        },
        {
            label: "字符串 fields",
            action: "get_migration_intent",
            params: { migration_intent_id: "123", fields: "id,status" },
        },
        {
            label: "未知查询字段",
            action: "get_migration_intent",
            params: { migration_intent_id: "123", fields: ["details"] },
        },
        {
            label: "未知迁移意图",
            action: "set_solution_migration_intent",
            params: { request: { solution_id: "111", migration_intent: "MIGRATE" } },
        },
        {
            label: "非数字 solution ID",
            action: "set_solution_migration_intent",
            params: {
                request: { solution_id: "solution-1", migration_intent: "INITIATE_MIGRATION" },
            },
        },
        {
            label: "非法调度时间",
            action: "set_solution_migration_intent",
            params: {
                request: {
                    solution_id: "111",
                    migration_intent: "SCHEDULE_MIGRATION",
                    scheduled_migration_time: "tomorrow",
                },
            },
        },
        {
            label: "未知请求字段",
            action: "set_solution_migration_intent",
            params: {
                request: { solution_id: "111", migration_intent: "CANCEL_MIGRATION", force: true },
            },
        },
    ])("拒绝非法迁移请求：$label", async ({ action, params }) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it("拒绝未知迁移状态与不完整设置响应", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ id: "123", status: "PENDING" }))
            .mockResolvedValueOnce(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.solutionMigration.get("123")).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
        await expect(
            client.solutionMigration.set({
                solution_id: "111",
                migration_intent: "CANCEL_MIGRATION",
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_RESPONSE" });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function bodyAt(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
    return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
}
