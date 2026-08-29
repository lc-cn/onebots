import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectWhatsAppWebhook } from "./events.js";
import type { WhatsAppWebhookEvent } from "./types.js";

const context = {
    botId: id("bot"),
    createId: (value: string | number) => id(String(value)),
};

describe("WhatsApp Webhook 投影", () => {
    it("完整展开同一批次的消息、状态和未知 change", () => {
        const webhook: WhatsAppWebhookEvent = {
            object: "whatsapp_business_account",
            entry: [
                {
                    id: "waba",
                    changes: [
                        {
                            field: "messages",
                            value: {
                                metadata: {
                                    display_phone_number: "123",
                                    phone_number_id: "phone",
                                },
                                contacts: [{ profile: { name: "Alice" }, wa_id: "86123" }],
                                messages: [
                                    {
                                        id: "wamid.1",
                                        from: "86123",
                                        timestamp: "10",
                                        type: "text",
                                        text: { body: "hello" },
                                    },
                                ],
                                statuses: [
                                    {
                                        id: "wamid.out",
                                        recipient_id: "86123",
                                        timestamp: "11",
                                        status: "read",
                                    },
                                ],
                            },
                        },
                        { field: "account_update", value: { event: "VERIFIED_ACCOUNT" } },
                    ],
                },
            ],
        };
        const result = projectWhatsAppWebhook(webhook, context);
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({
            type: "message",
            sender: { name: "Alice" },
            message: [{ type: "text", data: { text: "hello" } }],
        });
        expect(result[0]?.raw_event).toBe(webhook.entry[0]?.changes[0]);
        expect(result[1]).toMatchObject({ notice_type: "message_status" });
        expect(result[2]).toMatchObject({ notice_type: "custom" });
        expect(result[2]?.timestamp).toBeLessThanOrEqual(Date.now());
    });
});

function id(value: string): CommonTypes.Id {
    return { string: value, source: value, number: Number(value) };
}
