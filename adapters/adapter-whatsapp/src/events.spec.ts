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
        expect(projectWhatsAppWebhook(webhook, context)[2]?.id).toEqual(result[2]?.id);
    });

    it("保留 Flow 回复并投影可读摘要", () => {
        const [event] = projectWhatsAppWebhook(
            {
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [
                            {
                                field: "messages",
                                value: {
                                    messages: [
                                        {
                                            id: "flow-1",
                                            from: "86123",
                                            timestamp: "10",
                                            type: "interactive",
                                            interactive: {
                                                type: "nfm_reply",
                                                nfm_reply: {
                                                    name: "flow",
                                                    body: "Submitted",
                                                    response_json: '{"choice":"A"}',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
            context,
        );

        expect(event).toMatchObject({
            type: "message",
            raw_message: "Submitted",
            message: [
                {
                    type: "interactive",
                    data: {
                        interactive: {
                            type: "nfm_reply",
                            nfm_reply: { response_json: '{"choice":"A"}' },
                        },
                    },
                },
            ],
        });
    });

    it("将空 emoji 的 Reaction 投影为移除 notice", () => {
        const [event] = projectWhatsAppWebhook(
            {
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [
                            {
                                field: "messages",
                                value: {
                                    messages: [
                                        {
                                            id: "reaction-1",
                                            from: "86123",
                                            timestamp: "10",
                                            type: "reaction",
                                            reaction: { message_id: "wamid.1", emoji: "" },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
            context,
        );

        expect(event).toMatchObject({
            type: "notice",
            notice_type: "reaction_removed",
            message_id: { string: "wamid.1" },
            user: { id: { string: "86123" } },
            extensions: { whatsapp: { emoji: "" } },
        });
    });

    it("按 group_id 投影群消息与群 Reaction", () => {
        const result = projectWhatsAppWebhook(
            {
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [
                            {
                                field: "messages",
                                value: {
                                    contacts: [
                                        {
                                            profile: { name: "Alice" },
                                            user_id: "BR.123",
                                            username: "alice",
                                        },
                                    ],
                                    messages: [
                                        {
                                            id: "group-message",
                                            from: "BR.123",
                                            group_id: "group@g.us",
                                            timestamp: "10",
                                            type: "text",
                                            text: { body: "hello group" },
                                        },
                                        {
                                            id: "group-reaction",
                                            from: "BR.123",
                                            group_id: "group@g.us",
                                            timestamp: "11",
                                            type: "reaction",
                                            reaction: { message_id: "group-message", emoji: "👍" },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
            context,
        );

        expect(result[0]).toMatchObject({
            type: "message",
            message_type: "group",
            sender: { id: { string: "BR.123" }, name: "Alice" },
            group: { id: { string: "group@g.us" } },
        });
        expect(result[1]).toMatchObject({
            notice_type: "reaction_added",
            group: { id: { string: "group@g.us" } },
        });
    });

    it("把群 pin/unpin 投影为带目标消息的结构化 notice", () => {
        const [event] = projectWhatsAppWebhook(
            {
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [
                            {
                                field: "messages",
                                value: {
                                    messages: [
                                        {
                                            id: "pin-event",
                                            from: "BR.123",
                                            group_id: "group@g.us",
                                            timestamp: "12",
                                            type: "pin",
                                            pin: {
                                                type: "pin",
                                                message_id: "wamid.ABC==",
                                                expiration_days: 7,
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
            context,
        );

        expect(event).toMatchObject({
            type: "notice",
            notice_type: "custom",
            message_id: { string: "wamid.ABC==" },
            group: { id: { string: "group@g.us" } },
            extensions: { whatsapp: { pin: { type: "pin", expiration_days: 7 } } },
        });
    });

    it("把参与者变更与入群申请投影为 canonical 事件", () => {
        const result = projectWhatsAppWebhook(
            {
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
                                            timestamp: "20",
                                            group_id: "group@g.us",
                                            type: "group_add_participants",
                                            request_id: "request-add",
                                            added_participants: [{ wa_id: "86123" }],
                                        },
                                        {
                                            timestamp: "21",
                                            group_id: "group@g.us",
                                            type: "group_remove_participants",
                                            request_id: "request-remove",
                                            initiated_by: "participant",
                                            removed_participants: [{ input: "86124" }],
                                        },
                                        {
                                            timestamp: "22",
                                            group_id: "group@g.us",
                                            type: "group_join_request_created",
                                            join_request_id: "join-1",
                                            wa_id: "86125",
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
            context,
        );

        expect(result).toMatchObject([
            { type: "notice", notice_type: "group_increase", user: { id: { string: "86123" } } },
            { type: "notice", notice_type: "group_decrease", user: { id: { string: "86124" } } },
            {
                type: "request",
                request_type: "group",
                sub_type: "join_request",
                flag: "join-1",
                user: { id: { string: "86125" } },
            },
        ]);
    });

    it("保留生命周期、设置和冻结更新为结构化 custom notice", () => {
        const result = projectWhatsAppWebhook(
            {
                object: "whatsapp_business_account",
                entry: [
                    {
                        id: "waba",
                        changes: [
                            {
                                field: "group_lifecycle_update",
                                value: {
                                    groups: [
                                        {
                                            timestamp: "30",
                                            group_id: "group@g.us",
                                            type: "group_create",
                                            request_id: "request-1",
                                            subject: "Support",
                                        },
                                    ],
                                },
                            },
                            {
                                field: "group_status_update",
                                value: {
                                    groups: [
                                        {
                                            timestamp: "31",
                                            group_id: "group@g.us",
                                            type: "group_suspend",
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
            context,
        );

        expect(result).toMatchObject([
            {
                type: "notice",
                notice_type: "custom",
                group: { name: "Support" },
                extensions: { whatsapp: { group_update: { type: "group_create" } } },
            },
            {
                type: "notice",
                notice_type: "custom",
                extensions: { whatsapp: { group_update: { type: "group_suspend" } } },
            },
        ]);
    });
});

function id(value: string): CommonTypes.Id {
    return { string: value, source: value, number: Number(value) };
}
