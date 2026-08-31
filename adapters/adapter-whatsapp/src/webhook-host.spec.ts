import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import type { WhatsAppConfig } from "./types.js";
import { WhatsAppWebhookHost } from "./webhook-host.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    app_secret: "secret",
    business_account_id: "waba",
    phone_number_id: "phone",
    access_token: "token",
    webhook_verify_token: "verify",
    api_version: "v23.0",
};

const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

describe("WhatsAppWebhookHost", () => {
    it("使用 Meta 的 hub.* 查询参数完成验证", () => {
        const host = new WhatsAppWebhookHost(config, new WhatsAppClient(config));
        expect(
            host.acceptVerification({
                "hub.mode": "subscribe",
                "hub.verify_token": "verify",
                "hub.challenge": "1234",
            }),
        ).toMatchObject({ status: 200, body: "1234" });
    });

    it("验证原始请求签名并过滤重复投递", async () => {
        const client = new WhatsAppClient(config);
        const listener = vi.fn();
        client.on("webhook", listener);
        const host = new WhatsAppWebhookHost(config, client);
        const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
        await expect(host.ingest({ body, signature })).resolves.toMatchObject({ status: 200 });
        await expect(host.ingest({ body, signature })).resolves.toMatchObject({
            status: 200,
            body: { duplicate: true },
        });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("拒绝缺失或错误的签名", async () => {
        const host = new WhatsAppWebhookHost(config, new WhatsAppClient(config));
        await expect(host.ingest({ body })).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_SIGNATURE",
            status: 401,
        });
    });
});
