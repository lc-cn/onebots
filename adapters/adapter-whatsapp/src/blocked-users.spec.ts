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

describe("WhatsAppBlockedUsers", () => {
    it("校验封禁列表及游标", async () => {
        const fetcher = jsonFetcher({
            data: [{ messaging_product: "whatsapp", wa_id: "16505551234" }],
            paging: {
                cursors: { before: "before", after: "next" },
                next: "https://graph.facebook.com/v23.0/phone/block_users?after=next",
            },
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.blockedUsers.list({ limit: 20, after: "current" })).resolves.toEqual({
            data: [{ messaging_product: "whatsapp", wa_id: "16505551234" }],
            paging: {
                cursors: { before: "before", after: "next" },
                next: "https://graph.facebook.com/v23.0/phone/block_users?after=next",
            },
        });
        const url = requestUrl(fetcher);
        expect(url.searchParams.get("limit")).toBe("20");
        expect(url.searchParams.get("after")).toBe("current");
    });

    it("批量封禁、去重并保留规范化结果", async () => {
        const fetcher = jsonFetcher({
            messaging_product: "whatsapp",
            block_users: {
                added_users: [{ input: "+16505551234", wa_id: "16505551234" }],
            },
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "block_users", {
                users: ["+16505551234", "+16505551234"],
            }),
        ).resolves.toMatchObject({ block_users: { added_users: [{ wa_id: "16505551234" }] } });
        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            block_users: [{ user: "+16505551234" }],
        });
    });

    it("批量解封并使用 DELETE body", async () => {
        const fetcher = jsonFetcher({
            messaging_product: "whatsapp",
            block_users: {
                removed_users: [{ input: "+16505551234", wa_id: "16505551234" }],
            },
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.blockedUsers.unblock(["+16505551234"])).resolves.toMatchObject({
            block_users: { removed_users: [{ input: "+16505551234" }] },
        });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("DELETE");
    });

    it.each([
        ["单个字符串", "block_users", { users: "+16505551234" }],
        ["非 E.164", "block_users", { users: ["16505551234"] }],
        ["空列表", "unblock_users", { users: [] }],
        ["非法分页", "list_blocked_users", { limit: 0 }],
        ["附加字段", "list_blocked_users", { fields: ["wa_id"] }],
    ])("拒绝%s", async (_label, action, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it.each([
        { data: [{ messaging_product: "messenger", wa_id: "16505551234" }] },
        { data: [{ messaging_product: "whatsapp", wa_id: "+16505551234" }] },
        { messaging_product: "whatsapp", block_users: { added_users: [{}] } },
    ])("拒绝畸形响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "data" in response
                ? client.blockedUsers.list()
                : client.blockedUsers.block(["+16505551234"]);
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
