import { describe, expect, it } from "vitest";
import { projectInstagramEvent } from "./events.js";
import type { InstagramDelivery, InstagramEventType } from "./types.js";

const context = {
    botId: id("100"),
    createId: (value: string | number) => id(String(value)),
};

describe("Instagram canonical events", () => {
    it("投影 direct message、echo、read、edit、delete 与 reaction", () => {
        expect(
            projectInstagramEvent(
                delivery("message", { message: { mid: "m1", text: "hi" } }),
                context,
            )[0],
        ).toMatchObject({
            type: "message",
            message_type: "direct",
            message_id: id("m1"),
            sender: { id: id("200") },
            message: [{ type: "text", data: { text: "hi" } }],
        });
        expect(
            projectInstagramEvent(
                delivery("message_echo", { message: { mid: "m2", is_echo: true } }),
                context,
            )[0],
        ).toMatchObject({
            type: "notice",
            notice_type: "message_status",
            sub_type: "echo",
        });
        expect(
            projectInstagramEvent(delivery("read", { read: { mid: "m2" } }), context)[0],
        ).toMatchObject({
            notice_type: "message_status",
            sub_type: "read",
            message_id: id("m2"),
        });
        expect(
            projectInstagramEvent(
                delivery("message_edit", { message_edit: { mid: "m1", text: "new", num_edit: 1 } }),
                context,
            )[0],
        ).toMatchObject({
            notice_type: "message_updated",
            message_id: id("m1"),
        });
        expect(
            projectInstagramEvent(
                delivery("message_deleted", { message: { mid: "m1", is_deleted: true } }),
                context,
            )[0],
        ).toMatchObject({
            notice_type: "message_deleted",
        });
        expect(
            projectInstagramEvent(
                delivery("reaction", { reaction: { mid: "m1", action: "unreact" } }),
                context,
            )[0],
        ).toMatchObject({
            notice_type: "reaction_removed",
            message_id: id("m1"),
        });
    });

    it("postback 投影 interaction，其他官方事件落入带原始扩展的 custom", () => {
        expect(
            projectInstagramEvent(
                delivery("postback", { postback: { mid: "m1", title: "Help", payload: "HELP" } }),
                context,
            )[0],
        ).toMatchObject({
            notice_type: "interaction",
            sub_type: "postback",
        });
        expect(
            projectInstagramEvent(
                delivery("referral", {
                    referral: { ref: "ad", source: "ig.me", type: "OPEN_THREAD" },
                }),
                context,
            )[0],
        ).toMatchObject({
            notice_type: "custom",
            sub_type: "referral",
            extensions: {
                instagram: { messaging: expect.objectContaining({ referral: expect.any(Object) }) },
            },
        });
    });
});

function delivery(
    eventType: InstagramEventType,
    payload: Record<string, unknown>,
): InstagramDelivery {
    const raw = {
        sender: { id: "200" },
        recipient: { id: "100" },
        timestamp: 1_788_000_000_001,
        ...payload,
    };
    return {
        id: `delivery-${eventType}`,
        event: {
            event_type: eventType,
            source: "messaging",
            instagram_user_id: "100",
            entry_time: 1_788_000_000_000,
            messaging: {
                sender: { id: "200" },
                recipient: { id: "100" },
                timestamp: 1_788_000_000_001,
                raw,
                ...payload,
            },
        },
        rawEnvelope: {
            object: "instagram",
            entry: [],
            raw: { object: "instagram" },
        },
    } as InstagramDelivery;
}

function id(value: string) {
    return { platform: "instagram", value, string: value };
}
