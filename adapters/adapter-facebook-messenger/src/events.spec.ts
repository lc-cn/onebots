import { describe, expect, it } from "vitest";
import { projectFacebookMessengerEvent } from "./events.js";
import type { FacebookMessengerDelivery } from "./types.js";

const id = (source: string | number) => ({ string: String(source), source, number: 0 });

describe("Facebook Messenger canonical 事件", () => {
    it("将用户消息投影为 direct message 并保留原始 envelope", () => {
        const [event] = projectFacebookMessengerEvent(
            delivery("message", {
                message: {
                    mid: "m1",
                    text: "hello",
                    attachments: [{ type: "image", payload: { url: "https://cdn/a" } }],
                },
            }),
            { botId: id("100"), createId: id },
        );
        expect(event).toMatchObject({
            type: "message",
            message_type: "direct",
            message_id: { string: "m1" },
            sender: { id: { string: "200" } },
            raw_message: "hello",
            raw_event: { object: "page" },
        });
    });

    it("逐 message_id 投影 delivery，并区分 reaction add/remove", () => {
        const delivered = projectFacebookMessengerEvent(
            delivery("delivery", { delivery: { mids: ["m1", "m2"], watermark: 10 } }),
            { botId: id("100"), createId: id },
        );
        expect(delivered).toHaveLength(2);
        expect(delivered.map(event => event.message_id?.string)).toEqual(["m1", "m2"]);

        const [reaction] = projectFacebookMessengerEvent(
            delivery("reaction", {
                reaction: { mid: "m1", action: "unreact", emoji: "❤️" },
            }),
            { botId: id("100"), createId: id },
        );
        expect(reaction).toMatchObject({
            type: "notice",
            notice_type: "reaction_removed",
            message_id: { string: "m1" },
        });
    });

    it("将 postback 投影为 interaction，其余平台事件保留为 custom", () => {
        const [postback] = projectFacebookMessengerEvent(
            delivery("postback", { postback: { payload: "MENU", mid: "m1" } }),
            { botId: id("100"), createId: id },
        );
        expect(postback).toMatchObject({ notice_type: "interaction", sub_type: "postback" });

        const customDelivery = delivery("handover", {
            pass_thread_control: { new_owner_app_id: "300" },
        });
        customDelivery.event.source = "standby";
        const [custom] = projectFacebookMessengerEvent(customDelivery, {
            botId: id("100"),
            createId: id,
        });
        expect(custom).toMatchObject({
            notice_type: "custom",
            sub_type: "standby_handover",
        });
    });
});

function delivery(
    eventType: FacebookMessengerDelivery["event"]["event_type"],
    payload: Record<string, unknown>,
): FacebookMessengerDelivery {
    const raw = {
        sender: { id: "200" },
        recipient: { id: "100" },
        timestamp: 100,
        ...payload,
    };
    return {
        id: `delivery:${eventType}`,
        event: {
            event_type: eventType,
            source: "messaging",
            page_id: "100",
            entry_time: 99,
            messaging: {
                sender: { id: "200" },
                recipient: { id: "100" },
                timestamp: 100,
                raw,
                ...payload,
            },
        },
        rawEnvelope: {
            object: "page",
            entry: [],
            raw: { object: "page" },
        },
    } as FacebookMessengerDelivery;
}
