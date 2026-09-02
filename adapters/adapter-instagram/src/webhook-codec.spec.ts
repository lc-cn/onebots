import { describe, expect, it } from "vitest";
import { InstagramWebhookCodec } from "./webhook-codec.js";

describe("InstagramWebhookCodec", () => {
    it("展开 messaging、standby 与 field/value，并生成稳定 delivery 身份", () => {
        const codec = new InstagramWebhookCodec("100");
        const first = codec.parse({
            object: "instagram",
            entry: [
                {
                    id: "100",
                    time: 1_788_000_000_000,
                    messaging: [
                        item({ message: { mid: "m1", text: "hello" } }),
                        item({ reaction: { mid: "m1", action: "react", reaction: "love" } }),
                        item({ read: { mid: "m1" } }),
                        item({ message_edit: { mid: "m1", text: "edited", num_edit: 1 } }),
                    ],
                    standby: [item({ postback: { mid: "m2", title: "Help", payload: "HELP" } })],
                },
                {
                    id: "100",
                    time: 1_788_000_000_002,
                    field: "comments",
                    value: { id: "300", text: "nice" },
                },
            ],
        });
        const deliveries = codec.expand(first);
        expect(deliveries.map(delivery => delivery.event.event_type)).toEqual([
            "message",
            "reaction",
            "read",
            "message_edit",
            "postback",
            "change",
        ]);
        expect(new Set(deliveries.map(delivery => delivery.id)).size).toBe(6);
        expect(deliveries[4].event.source).toBe("standby");
        expect(deliveries[5].event.change?.field).toBe("comments");
    });

    it("区分 echo、deleted、unsupported、referral 与 handover", () => {
        const codec = new InstagramWebhookCodec("100");
        const envelope = codec.parse({
            object: "instagram",
            entry: [
                {
                    id: "100",
                    time: 1,
                    messaging: [
                        item({ message: { mid: "echo", is_echo: true } }),
                        item({ message: { mid: "deleted", is_deleted: true } }),
                        item({ message: { mid: "unsupported", is_unsupported: true } }),
                        item({
                            referral: { ref: "campaign", source: "ig.me", type: "OPEN_THREAD" },
                        }),
                        item({ pass_thread_control: { new_owner_app_id: "10" } }),
                    ],
                },
            ],
        });
        expect(codec.expand(envelope).map(delivery => delivery.event.event_type)).toEqual([
            "message_echo",
            "message_deleted",
            "message_unsupported",
            "referral",
            "handover",
        ]);
    });

    it("按 event_types 过滤，并拒绝跨账号、错误 object 与畸形 payload", () => {
        const filtered = new InstagramWebhookCodec("100", ["message"]);
        expect(
            filtered.expand(
                filtered.parse({
                    object: "instagram",
                    entry: [
                        {
                            id: "100",
                            time: 1,
                            messaging: [
                                item({ message: { mid: "m1", text: "hello" } }),
                                item({ read: { mid: "m1" } }),
                            ],
                        },
                    ],
                }),
            ),
        ).toHaveLength(1);
        const codec = new InstagramWebhookCodec("100");
        expect(() => codec.parse({ object: "page", entry: [] })).toThrow(/instagram/u);
        expect(() =>
            codec.parse({
                object: "instagram",
                entry: [{ id: "999", time: 1, messaging: [item({ read: { mid: "m1" } })] }],
            }),
        ).toThrow(/instagram_user_id/u);
        expect(() =>
            codec.parse({
                object: "instagram",
                entry: [
                    {
                        id: "100",
                        time: 1,
                        messaging: [item({ reaction: { mid: "m1", action: "toggle" } })],
                    },
                ],
            }),
        ).toThrow(/react 或 unreact/u);
    });
});

function item(payload: Record<string, unknown>): Record<string, unknown> {
    return {
        sender: { id: "200" },
        recipient: { id: "100" },
        timestamp: 1_788_000_000_001,
        ...payload,
    };
}
