import { describe, expect, it } from "vitest";
import { FacebookMessengerWebhookCodec } from "./webhook-codec.js";

describe("FacebookMessengerWebhookCodec", () => {
    it("展开 messaging、standby、changes 并为每个 delivery 生成稳定身份", () => {
        const codec = new FacebookMessengerWebhookCodec("100");
        const envelope = codec.parse({
            object: "page",
            entry: [
                {
                    id: "100",
                    time: 1_788_000_000_000,
                    messaging: [
                        item({ message: { mid: "m1", text: "hello" } }),
                        item({ delivery: { mids: ["m2", "m3"], watermark: 100 } }),
                        item({ reaction: { mid: "m1", action: "react", emoji: "❤️" } }),
                    ],
                    standby: [item({ postback: { payload: "MENU" } })],
                    changes: [{ field: "messenger_template_status_update", value: { id: "t1" } }],
                },
            ],
        });
        const deliveries = codec.expand(envelope);
        expect(deliveries.map(delivery => delivery.event.event_type)).toEqual([
            "message",
            "delivery",
            "reaction",
            "postback",
            "change",
        ]);
        expect(new Set(deliveries.map(delivery => delivery.id)).size).toBe(5);
        expect(deliveries[3].event.source).toBe("standby");
        expect(deliveries[0].rawEnvelope.raw).toMatchObject({ object: "page" });
    });

    it("在 batch 展开阶段执行显式 event_types 过滤", () => {
        const codec = new FacebookMessengerWebhookCodec("100", ["message"]);
        const envelope = codec.parse({
            object: "page",
            entry: [
                {
                    id: "100",
                    time: 1,
                    messaging: [
                        item({ message: { mid: "m1", text: "hello" } }),
                        item({ read: { watermark: 2 } }),
                    ],
                },
            ],
        });
        expect(codec.expand(envelope)).toHaveLength(1);
    });

    it("拒绝跨 Page、缺字段、错误 payload 与非整数时间戳", () => {
        const codec = new FacebookMessengerWebhookCodec("100");
        expect(() =>
            codec.parse({ object: "page", entry: [{ id: "999", time: 1, messaging: [] }] }),
        ).toThrow(/没有 messaging/u);
        expect(() =>
            codec.parse({
                object: "page",
                entry: [{ id: "999", time: 1, messaging: [item({ read: { watermark: 1 } })] }],
            }),
        ).toThrow(/page_id/u);
        expect(() =>
            codec.parse({
                object: "page",
                entry: [
                    {
                        id: "100",
                        time: 1,
                        messaging: [item({ reaction: { mid: "m", action: "toggle" } })],
                    },
                ],
            }),
        ).toThrow(/react 或 unreact/u);
        expect(() =>
            codec.parse({
                object: "page",
                entry: [{ id: "100", time: 1.5, messaging: [item({ read: { watermark: 1 } })] }],
            }),
        ).toThrow(/安全整数/u);
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
