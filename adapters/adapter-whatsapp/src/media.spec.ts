import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { WHATSAPP_MEDIA_LIMITS } from "./media.js";
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

const mediaInfo = {
    messaging_product: "whatsapp" as const,
    url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/file",
    mime_type: "image/jpeg",
    sha256: "hash",
    file_size: "303833",
    id: "media",
};

describe("WhatsAppMedia", () => {
    it("按官方 multipart 契约上传并校验媒体 ID", async () => {
        const fetcher = jsonFetcher({ id: "uploaded" });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.media.upload(new Blob(["image"], { type: "image/jpeg" }), "image/jpeg", "a.jpg"),
        ).resolves.toEqual({ id: "uploaded" });

        const form = fetcher.mock.calls[0]?.[1]?.body;
        expect(form).toBeInstanceOf(FormData);
        if (!(form instanceof FormData)) throw new Error("测试请求体不是 FormData");
        expect(form.get("messaging_product")).toBe("whatsapp");
        expect(form.get("type")).toBeNull();
        const file = form.get("file");
        expect(file).toBeInstanceOf(Blob);
        expect(file).toMatchObject({ name: "a.jpg", type: "image/jpeg", size: 5 });
    });

    it("公开官方 MIME 上限并在发起请求前拒绝超限内容", async () => {
        expect(WHATSAPP_MEDIA_LIMITS["image/jpeg"]).toBe(5 * 1024 * 1024);
        const fetcher = vi.fn<typeof fetch>();
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.media.upload(
                new Blob([new Uint8Array(WHATSAPP_MEDIA_LIMITS["image/jpeg"] + 1)], {
                    type: "image/jpeg",
                }),
                "image/jpeg",
            ),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("获取媒体时绑定当前 Phone Number 并保留官方字符串 file_size", async () => {
        const fetcher = jsonFetcher(mediaInfo);
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.media.get("media")).resolves.toEqual(mediaInfo);
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe("/v23.0/media");
        expect(url.searchParams.get("phone_number_id")).toBe("phone");
    });

    it("鉴权下载受信任临时 URL，并拒绝向任意域发送令牌", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("media"));
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.media.downloadFrom(mediaInfo)).resolves.toEqual(Buffer.from("media"));
        expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
            "Bearer token",
        );

        await expect(
            client.media.downloadFrom({ ...mediaInfo, url: "https://evil.example/file" }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_MEDIA_URL" });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("download_media 复用一次元数据并返回结构化 Base64", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json(mediaInfo))
            .mockResolvedValueOnce(new Response("binary"));
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "download_media", { media_id: "media" }),
        ).resolves.toEqual({ ...mediaInfo, data: Buffer.from("binary").toString("base64") });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("媒体动作拒绝契约外顶层字段并保留动作上下文", async () => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "get_media", {
                media_id: "media",
                mediaId: "typo",
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "get_media", parameter: "mediaId" },
        });
    });

    it("删除媒体时绑定当前 Phone Number 并校验 success", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.media.delete("media")).resolves.toEqual({ success: true });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe("DELETE");
        expect(requestUrl(fetcher).searchParams.get("phone_number_id")).toBe("phone");
    });

    it.each([
        ["空数据", "upload_media", { data: "", mime_type: "image/jpeg" }],
        ["非法 Base64", "upload_media", { data: "***", mime_type: "image/jpeg" }],
        ["未知 MIME", "upload_media", { data: "YQ==", mime_type: "image/gif" }],
        ["路径文件名", "upload_media", { data: "YQ==", mime_type: "image/jpeg", filename: "a/b" }],
        ["非法 ID", "get_media", { media_id: "../media" }],
    ])("拒绝%s", async (_label, action, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it.each([
        { id: "" },
        { ...mediaInfo, messaging_product: "messenger" },
        { ...mediaInfo, file_size: 303833 },
        { ...mediaInfo, url: "http://lookaside.fbsbx.com/file" },
        { success: false },
    ])("拒绝畸形响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "success" in response
                ? client.media.delete("media")
                : "url" in response
                  ? client.media.get("media")
                  : client.media.upload(new Blob(["a"], { type: "image/jpeg" }), "image/jpeg");
        await expect(operation).rejects.toMatchObject({ code: "WHATSAPP_INVALID_RESPONSE" });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function requestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): URL {
    return new URL(String(fetcher.mock.calls[0]?.[0]));
}
