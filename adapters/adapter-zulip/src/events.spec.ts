import { describe, expect, it } from "vitest";
import { projectZulipEvent } from "./events.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});
const context = {
    botId: createId(1),
    botUserId: 1,
    serverUrl: "https://example.zulipchat.com",
    createId,
};

describe("Zulip 事件投影", () => {
    it("保留频道话题、附件和原始事件", () => {
        const raw = {
            id: 7,
            type: "message" as const,
            message: {
                id: 42,
                type: "stream" as const,
                sender_id: 2,
                sender_email: "alice@example.com",
                sender_full_name: "Alice",
                content: "原始 Markdown",
                display_recipient: "engineering",
                stream_id: 5,
                subject: "release",
                timestamp: 100,
                attachments: [{ id: 3, name: "a.png", size: 12, path: "/user_uploads/a.png" }],
            },
        };

        const event = projectZulipEvent(raw, context);

        expect(event).toMatchObject({
            type: "message",
            message_type: "group",
            raw_event: raw,
            group: { id: { string: "5/release" }, name: "engineering" },
            message: [
                { type: "text", data: { text: "原始 Markdown" } },
                {
                    type: "image",
                    data: {
                        name: "a.png",
                        url: "https://example.zulipchat.com/user_uploads/a.png",
                    },
                },
            ],
        });
    });

    it("投影反应、心跳和未知事件", () => {
        expect(
            projectZulipEvent(
                {
                    id: 8,
                    type: "reaction",
                    op: "remove",
                    message_id: 42,
                    emoji_name: "thumbs_up",
                    emoji_code: "1f44d",
                    reaction_type: "unicode_emoji",
                    user_id: 2,
                },
                context,
            ),
        ).toMatchObject({ type: "notice", notice_type: "reaction_removed" });
        expect(projectZulipEvent({ id: 9, type: "heartbeat" }, context)).toMatchObject({
            type: "meta",
            meta_type: "heartbeat",
        });
        expect(projectZulipEvent({ id: 10, type: "typing", op: "start" }, context)).toMatchObject({
            type: "notice",
            notice_type: "custom",
        });
    });

    it("区分多人私聊并保留可回复的收件人场景", () => {
        const event = projectZulipEvent(
            {
                id: 11,
                type: "message",
                message: {
                    id: 43,
                    type: "private",
                    sender_id: 2,
                    sender_email: "alice@example.com",
                    sender_full_name: "Alice",
                    content: "hello team",
                    timestamp: 100,
                    display_recipient: [
                        { id: 1, email: "bot@example.com", full_name: "Bot" },
                        { id: 2, email: "alice@example.com", full_name: "Alice" },
                        { id: 3, email: "bob@example.com", full_name: "Bob" },
                    ],
                },
            },
            context,
        );

        expect(event).toMatchObject({
            type: "message",
            message_type: "direct",
            extensions: { zulip: { scene_id: "2,3" } },
        });
    });
});
