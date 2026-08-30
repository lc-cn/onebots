import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WhatsAppClient } from "./client.js";
import type { WhatsAppConfig } from "./types.js";
import { routeWhatsAppWebhook, WhatsAppWebhookRouter } from "./webhook-routing.js";

const config: WhatsAppConfig = {
    account_id: "bot-1",
    app_secret: "secret",
    business_account_id: "waba",
    phone_number_id: "phone-1",
    access_token: "token",
    webhook_verify_token: "verify",
    api_version: "v23.0",
};

describe("routeWhatsAppWebhook", () => {
    it("按 Phone Number ID 拆分同一 WABA 批次", () => {
        const deliveries = routeWhatsAppWebhook(
            {
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [
                            {
                                field: "messages",
                                value: {
                                    metadata: {
                                        display_phone_number: "1",
                                        phone_number_id: "phone-1",
                                    },
                                    messages: [],
                                },
                            },
                            {
                                field: "messages",
                                value: {
                                    metadata: {
                                        display_phone_number: "2",
                                        phone_number_id: "phone-2",
                                    },
                                    statuses: [],
                                },
                            },
                            { field: "account_update", value: { event: "VERIFIED_ACCOUNT" } },
                        ],
                    },
                ],
            },
            "phone-1",
        );

        expect(deliveries).toHaveLength(2);
        expect(deliveries[0]?.event.entry[0]?.changes.map(change => change.field)).toEqual([
            "messages",
            "account_update",
        ]);
        expect(deliveries[1]).toMatchObject({
            phoneNumberId: "phone-2",
            event: { entry: [{ changes: [{ field: "messages" }] }] },
        });
    });

    it("一次验签后分别交付两个号码，并为各 Client 独立去重", async () => {
        const first = new WhatsAppClient(config);
        const second = new WhatsAppClient({
            ...config,
            account_id: "bot-2",
            phone_number_id: "phone-2",
            receive_mode: "manual",
        });
        const router = new WhatsAppWebhookRouter();
        router.register(first);
        router.register(second);
        const firstMessage: string[] = [];
        const secondMessage: string[] = [];
        first.on("message", message => firstMessage.push(message.id));
        second.on("message", message => secondMessage.push(message.id));
        const body = JSON.stringify({
            object: "whatsapp_business_account",
            entry: [
                {
                    id: "waba",
                    changes: [
                        messageChange("phone-1", "message-1"),
                        messageChange("phone-2", "message-2"),
                    ],
                },
            ],
        });
        const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;

        await expect(router.ingest(first, { body, signature })).resolves.toMatchObject({
            accepted: 2,
            duplicate: false,
            changes: 2,
            ignoredChanges: 0,
        });
        await expect(router.ingest(first, { body, signature })).resolves.toMatchObject({
            duplicate: true,
        });
        expect(firstMessage).toEqual(["message-1"]);
        expect(secondMessage).toEqual(["message-2"]);
    });

    it("拒绝同一 Phone Number ID 注册两个 Client", () => {
        const router = new WhatsAppWebhookRouter();
        router.register(new WhatsAppClient(config));
        expect(() => router.register(new WhatsAppClient(config))).toThrow("已被其他账号使用");
    });
});

function messageChange(phoneNumberId: string, messageId: string) {
    return {
        field: "messages",
        value: {
            metadata: { display_phone_number: phoneNumberId, phone_number_id: phoneNumberId },
            messages: [
                {
                    id: messageId,
                    from: "86123",
                    timestamp: "10",
                    type: "text" as const,
                    text: { body: messageId },
                },
            ],
        },
    };
}
