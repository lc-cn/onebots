import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectTeamsEvent } from "./events.js";
import type { TeamsEvent } from "./types.js";

const createId = (value: string | number): CommonTypes.Id => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});

function createEvent(): TeamsEvent {
    return {
        type: "message",
        activity: {
            type: "message",
            id: "message-1",
            timestamp: "2026-08-28T10:00:00.000Z",
            from: { id: "sender", name: "Sender" },
            conversation: { id: "group", name: "Group", isGroup: true },
            channelId: "msteams",
            text: "hello",
            attachments: [{ contentType: "image/png", contentUrl: "https://example.com/a.png" }],
        },
    };
}

describe("projectTeamsEvent", () => {
    it("投影群消息并保留原始事件", () => {
        const raw = createEvent();
        const event = projectTeamsEvent("group_message", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "message",
            message_type: "group",
            raw_event: raw,
            group: { id: { string: "group" } },
        });
        expect(event.type === "message" && event.message.map(segment => segment.type)).toEqual([
            "text",
            "image",
        ]);
    });

    it("成员事件使用 membersAdded 中的真实成员", () => {
        const raw = createEvent();
        raw.activity.membersAdded = [{ id: "joined", name: "Joined" }];
        const event = projectTeamsEvent("member_joined", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "member_joined",
            user: { id: { string: "joined" } },
        });
    });

    it("编辑事件投影为携带新内容的 notice", () => {
        const raw = createEvent();
        const event = projectTeamsEvent("message_updated", raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "message_updated",
            message_id: { string: "message-1" },
        });
    });
});
