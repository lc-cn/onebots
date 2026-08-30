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

const requestJwe = "header.encrypted-key.iv.ciphertext.tag";
const responseJwe = "response-key.encrypted-key.iv.ciphertext.tag";

describe("WhatsAppEncryptedMessages", () => {
    it("只向固定端点发送官方加密载荷", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(Response.json({ encrypted_contents: responseJwe }));
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.encryptedMessages.send(requestJwe)).resolves.toEqual({
            encrypted_contents: responseJwe,
        });

        const [url, request] = fetcher.mock.calls[0] || [];
        expect(String(url)).toContain("/v23.0/phone/messages_encrypted");
        expect(JSON.parse(String(request?.body))).toEqual({
            messaging_product: "whatsapp",
            encrypted_contents: requestJwe,
        });
    });

    it("固定平台动作拒绝额外明文字段并保留动作上下文", async () => {
        const fetcher = vi.fn<typeof fetch>();
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            executeWhatsAppPlatformAction(client, "send_encrypted_message", {
                encrypted_contents: requestJwe,
                text: { body: "不得静默忽略" },
            }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_UNEXPECTED_ACTION_PARAMETER",
            details: { action: "send_encrypted_message", parameter: "text" },
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([
        "",
        "one.two.three.four",
        "one.two.three.four.five.six",
        "one.two.three.four.bad=padding",
        " one.two.three.four.five",
    ])("拒绝无效 compact JWE: %s", async encryptedContents => {
        const fetcher = vi.fn<typeof fetch>();
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.encryptedMessages.send(encryptedContents)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("拒绝未携带加密载荷的成功响应", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.encryptedMessages.send(requestJwe)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});
