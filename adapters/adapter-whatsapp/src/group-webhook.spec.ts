import { describe, expect, it } from "vitest";
import { isWhatsAppGroupWebhookEntry } from "./group-webhook.js";
import { parseWhatsAppWebhook } from "./webhook.js";

describe("WhatsApp Groups webhook 校验", () => {
    it("按 type 校验参与者与入群申请必填字段", () => {
        expect(
            isWhatsAppGroupWebhookEntry({
                timestamp: "1",
                group_id: "g1",
                type: "group_add_participants",
                request_id: "request-1",
                added_participants: [{ wa_id: "86123" }],
            }),
        ).toBe(true);
        expect(
            isWhatsAppGroupWebhookEntry({
                timestamp: "1",
                group_id: "g1",
                type: "group_join_request_created",
                join_request_id: "join-1",
            }),
        ).toBe(false);
    });

    it("在 ingest 前拒绝畸形 groups 数组", () => {
        expect(() =>
            parseWhatsAppWebhook({
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [
                            {
                                field: "group_participant_update",
                                value: {
                                    groups: [
                                        {
                                            timestamp: "1",
                                            group_id: "g1",
                                            type: "group_remove_participants",
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            }),
        ).toThrowError(expect.objectContaining({ code: "WHATSAPP_INVALID_WEBHOOK_BODY" }));
    });
});
