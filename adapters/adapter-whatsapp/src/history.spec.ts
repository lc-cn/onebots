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

const historyEntry = {
    id: "history-1",
    message_id: "wamid.message",
    events: {
        data: [
            {
                id: "event-1",
                delivery_status: "DELIVERED",
                timestamp: 1640995260,
                webhook_update_state: "DELIVERED",
                application: { id: "app-1" },
                webhook_uri: "https://example.com/webhook",
            },
        ],
    },
};

describe("WhatsApp 消息历史", () => {
    it("按 WAMID 查询完整投递与 Webhook 状态", async () => {
        const fetcher = jsonFetcher({ data: [historyEntry] });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.history.list({ message_id: "wamid.message", limit: 50 }),
        ).resolves.toEqual({ data: [historyEntry] });

        const url = new URL(requestUrl(fetcher));
        expect(`${url.origin}${url.pathname}`).toBe(
            "https://graph.facebook.com/v23.0/phone/message_history",
        );
        expect(url.searchParams.get("message_id")).toBe("wamid.message");
        expect(url.searchParams.get("limit")).toBe("50");
        expect(url.searchParams.get("fields")).toContain("webhook_update_state");
    });

    it("查询单条历史的状态事件边", async () => {
        const edge = {
            cursor: "cursor-1",
            node: {
                id: "event-1",
                delivery_status: "READ",
                occurrence_timestamp: 1640995320,
                status_timestamp: 1640995325,
                application: { id: "app-1", name: "Bot" },
            },
        };
        const fetcher = jsonFetcher({ data: [edge] });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.history.listEvents("history-1", { status_filter: "READ" }),
        ).resolves.toEqual({ data: [edge] });

        const url = new URL(requestUrl(fetcher));
        expect(url.pathname).toBe("/v23.0/history-1/events");
        expect(url.searchParams.get("status_filter")).toBe("READ");
    });

    it("沿 after cursor 拉取全部历史", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                response({ data: [historyEntry], paging: { cursors: { after: "next" } } }),
            )
            .mockResolvedValueOnce(response({ data: [{ ...historyEntry, id: "history-2" }] }));
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.history.listAll()).resolves.toHaveLength(2);
        expect(new URL(requestUrl(fetcher, 1)).searchParams.get("after")).toBe("next");
    });

    it("分页自环时拒绝返回不完整历史", async () => {
        const fetcher = jsonFetcher({
            data: [historyEntry],
            paging: { cursors: { after: "same" } },
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.history.listAll()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("固定平台动作复用 History 深模块", async () => {
        const fetcher = jsonFetcher({ data: [historyEntry] });
        const client = new WhatsAppClient(config, fetcher);

        await executeWhatsAppPlatformAction(client, "list_message_history", {
            message_id: "wamid.message",
        });

        expect(new URL(requestUrl(fetcher)).pathname).toBe("/v23.0/phone/message_history");
    });

    it("拒绝非法查询、路径和外部响应", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(client.history.list({ limit: 101 })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
        await expect(client.history.list({ after: "a", before: "b" })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
        await expect(client.history.listEvents("../other")).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });

        const invalid = new WhatsAppClient(config, jsonFetcher({ data: [{ id: "partial" }] }));
        await expect(invalid.history.list()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function jsonFetcher(payload: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockResolvedValue(response(payload));
}

function response(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
    });
}

function requestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): string {
    return String(fetcher.mock.calls[index]?.[0]);
}
