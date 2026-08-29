import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FeishuBot } from "./bot.js";

describe("FeishuBot webhook", () => {
    it("解密 encrypt 事件后校验 verification token 并投递", async () => {
        const encryptKey = "encrypt-key";
        const event = {
            schema: "2.0",
            header: {
                token: "verify-token",
                event_id: "EV1",
                event_type: "im.message.recalled_v1",
                create_time: "1710000000000",
                app_id: "cli_1",
                tenant_key: "tenant",
            },
            event: { message_id: "om_1" },
        };
        const bot = new FeishuBot({
            account_id: "A1",
            app_id: "cli_1",
            app_secret: "secret",
            encrypt_key: encryptKey,
            verification_token: "verify-token",
        });
        const listener = vi.fn();
        bot.on("event", listener);
        const ctx = {
            request: { body: { encrypt: encrypt(JSON.stringify(event), encryptKey) } },
            body: undefined,
        };

        await bot.handleWebhook(ctx as never, vi.fn());

        expect(listener).toHaveBeenCalledWith(event, event);
        expect(ctx.body).toEqual({ code: 0 });
    });
});

function encrypt(plaintext: string, encryptKey: string): string {
    const key = createHash("sha256").update(encryptKey).digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([iv, cipher.update(plaintext), cipher.final()]).toString("base64");
}
