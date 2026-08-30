import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
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

describe("WhatsApp Groups API", () => {
    const groupSummary = { id: "g1", subject: "One", created_at: "2026-01-01T00:00:00Z" };

    it("创建群时固定产品字段并校验审批模式", async () => {
        const fetcher = jsonFetcher({ request_id: "request-1" });
        const client = new WhatsAppClient(config, fetcher);

        await client.groups.create({
            subject: "Support",
            description: "Customer support",
            join_approval_mode: "approval_required",
        });

        expect(requestUrl(fetcher)).toBe("https://graph.facebook.com/v23.0/phone/groups");
        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            subject: "Support",
            description: "Customer support",
            join_approval_mode: "approval_required",
        });
        await expect(
            client.groups.create({ subject: "Support", join_approval_mode: "invalid" }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("通过受控资源管理邀请链接与入群申请", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response({ invite_link: "https://chat.whatsapp.com/example" }))
            .mockResolvedValueOnce(response({ approved_join_requests: ["join-1", "join-2"] }))
            .mockImplementation(async () => response({ rejected_join_requests: ["join-3"] }));
        const client = new WhatsAppClient(config, fetcher);

        await client.groups.createInviteLink("group@g.us");
        expect(requestUrl(fetcher)).toBe("https://graph.facebook.com/v23.0/group@g.us/invite_link");
        expect(requestJson(fetcher)).toEqual({ messaging_product: "whatsapp" });

        await client.groups.approveJoinRequests("group@g.us", ["join-1", "join-2"]);
        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            join_requests: ["join-1", "join-2"],
        });

        await client.groups.rejectJoinRequests("group@g.us", ["join-3"]);
        expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    });

    it("用官方 user 字段移除手机号或 BSUID", async () => {
        const fetcher = jsonFetcher({ request_id: "request-2" });
        const client = new WhatsAppClient(config, fetcher);

        await client.groups.removeParticipants("group@g.us", ["86123", "BR.123"]);

        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            participants: [{ user: "86123" }, { user: "BR.123" }],
        });
    });

    it("标准群列表沿 cursor 拉取全部页面", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                response({
                    data: { groups: [groupSummary] },
                    paging: { cursors: { after: "next" } },
                }),
            )
            .mockResolvedValueOnce(
                response({
                    data: {
                        groups: [{ ...groupSummary, id: "g2", subject: "Two" }],
                    },
                }),
            );
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.groups.listAll()).resolves.toEqual([
            groupSummary,
            { ...groupSummary, id: "g2", subject: "Two" },
        ]);
        expect(new URL(requestUrl(fetcher, 1)).searchParams.get("after")).toBe("next");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("分页 cursor 自环时拒绝返回不完整列表", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            response({
                data: { groups: [groupSummary] },
                paging: { cursors: { after: "same" } },
            }),
        );
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.groups.listAll()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("更新群头像使用 multipart 的官方字段", async () => {
        const fetcher = jsonFetcher({ request_id: "request-3" });
        const client = new WhatsAppClient(config, fetcher);

        await client.groups.update("group@g.us", {
            subject: "Renamed",
            profile_picture: "data:image/png;base64,aW1hZ2U=",
        });

        const form = fetcher.mock.calls[0]?.[1]?.body;
        expect(form).toBeInstanceOf(FormData);
        expect((form as FormData).get("messaging_product")).toBe("whatsapp");
        expect((form as FormData).get("subject")).toBe("Renamed");
        expect((form as FormData).get("file")).toBeInstanceOf(Blob);
    });

    it("用群消息原生类型 pin 与 unpin，并保留 wamid", async () => {
        const fetcher = jsonFetcher({
            messaging_product: "whatsapp",
            messages: [{ id: "pin-operation" }],
        });
        const client = new WhatsAppClient(config, fetcher);

        await client.groups.pinMessage("group@g.us", "wamid.ABC==", 7);
        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            recipient_type: "group",
            to: "group@g.us",
            type: "pin",
            pin: { type: "pin", message_id: "wamid.ABC==", expiration_days: 7 },
        });

        await client.groups.unpinMessage("group@g.us", "wamid.ABC==");
        expect(requestJson(fetcher)).toEqual({
            messaging_product: "whatsapp",
            recipient_type: "group",
            to: "group@g.us",
            type: "pin",
            pin: { type: "unpin", message_id: "wamid.ABC==" },
        });
    });

    it("拒绝路径注入和空更新", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(client.groups.get("../other")).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
        await expect(client.groups.update("group@g.us", {})).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it("拒绝非官方 flat data 列表形状", async () => {
        const client = new WhatsAppClient(config, jsonFetcher({ data: [] }));
        await expect(client.groups.list()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });

    it("拒绝缺少完整字段的群资料", async () => {
        const client = new WhatsAppClient(config, jsonFetcher({ id: "g1", subject: "Partial" }));
        await expect(client.groups.get("g1")).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });

    it("拒绝缺少 request_id 的异步操作响应", async () => {
        const client = new WhatsAppClient(config, jsonFetcher({ success: true }));
        await expect(client.groups.update("g1", { subject: "Renamed" })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function jsonFetcher(payload: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => response(payload));
}

function response(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
    });
}

function requestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): string {
    return String(fetcher.mock.calls[index]?.[0]);
}

function requestJson(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
    return JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
}
