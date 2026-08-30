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

const code = "ANED2T5QRU7HG1";
const details = {
    code,
    prefilled_message: "Hello",
    deep_link_url: `https://wa.me/message/${code}`,
};

describe("WhatsAppQrCodes", () => {
    it("以字段数组、图片格式、过滤条件和 cursor 查询列表", async () => {
        const fetcher = jsonFetcher({
            data: [{ ...details, creation_time: 1_672_531_200 }],
            paging: {
                cursors: { before: "before", after: "after-next" },
                next: "https://graph.facebook.com/v23.0/phone/message_qrdls?after=after-next",
            },
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.qrCodes.list({
                fields: ["code", "prefilled_message", "deep_link_url", "creation_time"],
                qr_image_format: "SVG",
                code,
                limit: 10,
                after: "after-current",
            }),
        ).resolves.toMatchObject({
            data: [{ code, creation_time: 1_672_531_200 }],
            paging: { cursors: { after: "after-next" } },
        });
        const url = new URL(String(fetcher.mock.calls[0]?.[0]));
        expect(url.searchParams.get("fields")).toBe(
            "code,prefilled_message,deep_link_url,creation_time,qr_image_url.format(SVG)",
        );
        expect(url.searchParams.get("code")).toBe(code);
        expect(url.searchParams.get("limit")).toBe("10");
        expect(url.searchParams.get("after")).toBe("after-current");
    });

    it("按官方单元素 data 数组读取单个二维码", async () => {
        const fetcher = jsonFetcher({
            data: [{ ...details, qr_image_url: "https://cdn.test/qr.png" }],
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.qrCodes.get(code, {
                fields: ["code", "prefilled_message", "deep_link_url"],
                qr_image_format: "PNG",
            }),
        ).resolves.toEqual({
            data: [{ ...details, qr_image_url: "https://cdn.test/qr.png" }],
        });
        const url = new URL(String(fetcher.mock.calls[0]?.[0]));
        expect(url.pathname).toBe(`/v23.0/phone/message_qrdls/${code}`);
        expect(url.searchParams.get("fields")).toContain("qr_image_url.format(PNG)");
    });

    it("接受 Graph fields 产生的稀疏查询投影", async () => {
        const fetcher = jsonFetcher({ data: [{ code }] });
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.qrCodes.list({ fields: ["code"] })).resolves.toEqual({
            data: [{ code }],
        });
    });

    it("创建时传递官方图片格式并校验结构化响应", async () => {
        const fetcher = jsonFetcher({ ...details, qr_image_url: "https://cdn.test/qr.svg" });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.qrCodes.create({ prefilled_message: "Hello", generate_qr_image: "SVG" }),
        ).resolves.toEqual({ ...details, qr_image_url: "https://cdn.test/qr.svg" });
        expect(requestJson(fetcher)).toEqual({
            prefilled_message: "Hello",
            generate_qr_image: "SVG",
        });
    });

    it("固定动作复用强类型更新与删除入口", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json(details))
            .mockResolvedValueOnce(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            executeWhatsAppPlatformAction(client, "update_qr_code", {
                code,
                prefilled_message: "Hello",
            }),
        ).resolves.toEqual(details);
        await expect(
            executeWhatsAppPlatformAction(client, "delete_qr_code", { code }),
        ).resolves.toEqual({ success: true });
        expect(requestJson(fetcher)).toEqual({ code, prefilled_message: "Hello" });
        expect(String(fetcher.mock.calls[1]?.[0])).toContain(`/message_qrdls/${code}`);
        expect(fetcher.mock.calls[1]?.[1]?.method).toBe("DELETE");
    });

    it.each([
        { label: "字符串 fields", action: "list_qr_codes", params: { fields: "code" } },
        { label: "未知字段", action: "list_qr_codes", params: { fields: ["name"] } },
        { label: "空字段数组", action: "list_qr_codes", params: { fields: [] } },
        {
            label: "错误图片格式",
            action: "create_qr_code",
            params: { prefilled_message: "Hi", generate_qr_image: "JPG" },
        },
        { label: "错误 code", action: "get_qr_code", params: { code: "Q1" } },
        {
            label: "超长消息",
            action: "create_qr_code",
            params: { prefilled_message: "x".repeat(141) },
        },
        { label: "越界 limit", action: "list_qr_codes", params: { limit: 26 } },
        { label: "附加参数", action: "delete_qr_code", params: { code, force: true } },
    ])("拒绝非法动作参数：$label", async ({ action, params }) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it.each([
        { data: [] },
        { data: [{ ...details, code: "invalid" }] },
        { data: [{ ...details, deep_link_url: "not-a-url" }] },
        { data: [{ ...details, creation_time: -1 }] },
    ])("拒绝畸形官方响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        await expect(client.qrCodes.get(code)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });

    it("拒绝畸形分页 URL", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({ data: [details], paging: { next: "not-a-url" } }),
        );
        await expect(client.qrCodes.list()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });

    it("拒绝虚假删除成功", async () => {
        const client = new WhatsAppClient(config, jsonFetcher({ success: false }));
        await expect(client.qrCodes.delete(code)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function requestJson(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
    return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
}
