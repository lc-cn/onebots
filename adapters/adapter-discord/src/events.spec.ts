import { describe, expect, it } from "vitest";
import { projectDiscordDispatch } from "./events.js";

const context = {
    botId: { string: "bot", number: 1, source: "bot" },
    createId: (value: string | number) => ({
        string: String(value),
        number: Number(value) || 1,
        source: value,
    }),
};

describe("projectDiscordDispatch", () => {
    it("投影消息的回复、附件与 sticker", () => {
        const rawEvent = {
            name: "MESSAGE_CREATE",
            data: {
                id: "10",
                channel_id: "20",
                guild_id: "30",
                author: { id: "40", username: "alice", discriminator: "0", avatar: null },
                content: "hello",
                timestamp: "2026-01-01T00:00:00.000Z",
                edited_timestamp: null,
                tts: false,
                mention_everyone: false,
                mentions: [],
                mention_roles: [],
                attachments: [
                    {
                        id: "50",
                        filename: "a.png",
                        content_type: "image/png",
                        size: 1,
                        url: "https://cdn/a.png",
                        proxy_url: "https://proxy/a.png",
                    },
                ],
                embeds: [],
                pinned: false,
                type: 0,
                message_reference: { message_id: "9" },
                sticker_items: [{ id: "60", name: "wave", format_type: 1 }],
            },
        };

        const event = projectDiscordDispatch(rawEvent, context);

        expect(event?.type).toBe("message");
        if (event?.type !== "message") throw new Error("expected message");
        expect(event.message.map(segment => segment.type)).toEqual([
            "reply",
            "text",
            "image",
            "sticker",
        ]);
        expect(event.raw_event).toBe(rawEvent);
    });

    it("未知 Dispatch 仍无损投影", () => {
        const rawEvent = { name: "AUTO_MODERATION_ACTION_EXECUTION", data: { rule_id: "1" } };
        expect(projectDiscordDispatch(rawEvent, context)).toMatchObject({
            type: "notice",
            notice_type: "custom",
            raw_event: rawEvent,
            extensions: { discord: { event_name: "AUTO_MODERATION_ACTION_EXECUTION" } },
        });
    });
});
