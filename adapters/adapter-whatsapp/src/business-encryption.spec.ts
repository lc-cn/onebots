import { generateKeyPairSync } from "node:crypto";
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

const publicKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();

describe("WhatsAppBusinessEncryption", () => {
    it("读取公钥与 Meta 签名状态", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            Response.json({
                data: [
                    {
                        business_public_key: publicKey,
                        business_public_key_signature_status: "VALID",
                    },
                ],
            }),
        );
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.businessEncryption.get()).resolves.toEqual({
            data: [
                {
                    business_public_key: publicKey,
                    business_public_key_signature_status: "VALID",
                },
            ],
        });
        expect(String(fetcher.mock.calls[0]?.[0])).toContain(
            "/phone/whatsapp_business_encryption?fields=",
        );
    });

    it("允许 Meta 在 MISMATCH 状态返回空白公钥", async () => {
        const client = new WhatsAppClient(
            config,
            vi.fn<typeof fetch>().mockResolvedValue(
                Response.json({
                    data: [
                        {
                            business_public_key: " ",
                            business_public_key_signature_status: "MISMATCH",
                        },
                    ],
                }),
            ),
        );
        await expect(client.businessEncryption.get()).resolves.toMatchObject({
            data: [{ business_public_key_signature_status: "MISMATCH" }],
        });
    });

    it("以 multipart 上传经过解析的 2048 位 RSA 公钥", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);

        await expect(client.businessEncryption.set(publicKey)).resolves.toEqual({ success: true });
        const form = formDataBody(fetcher);
        expect(form.get("business_public_key")).toBe(publicKey.trim());
        expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("Content-Type")).toBe(false);
    });

    it("固定平台动作不会转发额外字段", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);
        await executeWhatsAppPlatformAction(client, "set_business_encryption_key", {
            business_public_key: publicKey,
            private_key: "不得转发",
        });
        expect([...formDataBody(fetcher).keys()]).toEqual(["business_public_key"]);
    });

    it("拒绝非 RSA、低强度 RSA 和畸形 PEM", async () => {
        const ecKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
            .publicKey.export({ type: "spki", format: "pem" })
            .toString();
        const weakRsaKey = generateKeyPairSync("rsa", { modulusLength: 1024 })
            .publicKey.export({ type: "spki", format: "pem" })
            .toString();
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        for (const value of [ecKey, weakRsaKey, "not-a-key"]) {
            await expect(client.businessEncryption.set(value)).rejects.toMatchObject({
                code: "WHATSAPP_INVALID_PARAMETER",
            });
        }
    });

    it("拒绝未知签名状态和虚假成功响应", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                Response.json({
                    data: [
                        {
                            business_public_key: publicKey,
                            business_public_key_signature_status: "UNKNOWN",
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(Response.json({ success: false }));
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.businessEncryption.get()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
        await expect(client.businessEncryption.set(publicKey)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

function formDataBody(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): FormData {
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error("期望请求体为 FormData");
    return body;
}
