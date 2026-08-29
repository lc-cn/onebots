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

    it("恢复长连接 EventDispatcher 展平的官方事件 envelope", () => {
        const bot = new FeishuBot({
            account_id: "A1",
            app_id: "cli_configured",
            app_secret: "secret",
        });
        const listener = vi.fn();
        bot.on("event", listener);

        bot["emitLongConnectionEvent"]("im.message.receive_v1", {
            schema: "2.0",
            event_id: "EV_LONG_1",
            event_type: "im.message.receive_v1",
            create_time: "1710000000123",
            app_id: "cli_actual",
            tenant_key: "tenant_actual",
            token: "verify-token",
            message: { message_id: "om_1", chat_id: "oc_1" },
            sender: { sender_id: { open_id: "ou_1" } },
        });

        const restored = {
            schema: "2.0",
            header: {
                event_id: "EV_LONG_1",
                event_type: "im.message.receive_v1",
                create_time: "1710000000123",
                app_id: "cli_actual",
                tenant_key: "tenant_actual",
                token: "verify-token",
            },
            event: {
                message: { message_id: "om_1", chat_id: "oc_1" },
                sender: { sender_id: { open_id: "ou_1" } },
            },
        };
        expect(listener).toHaveBeenCalledWith(restored, restored);
    });
});

function encrypt(plaintext: string, encryptKey: string): string {
    const key = createHash("sha256").update(encryptKey).digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([iv, cipher.update(plaintext), cipher.final()]).toString("base64");
}
