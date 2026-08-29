import { describe, expect, it } from "vitest";
import { projectSlackEvent } from "./events.js";
import type { SlackEvent, SlackWebhookBody } from "./types.js";

const context = {
    botId: { string: "B1" } as never,
    createId: (value: string | number) => ({ string: String(value) }) as never,
};

describe("projectSlackEvent", () => {
    it("投影线程、文件并保留完整 Events API envelope", () => {
        const event = {
            type: "message",
            event_ts: "1710000000.000001",
            ts: "1710000000.000001",
            thread_ts: "1709999999.000001",
            channel: "C1",
            user: "U1",
            text: "hello",
            files: [
                {
                    id: "F1",
                    name: "voice.ogg",
                    url_private: "https://files/1",
                    mimetype: "audio/ogg",
                },
            ],
        } satisfies SlackEvent;
        const envelope: SlackWebhookBody = { type: "event_callback", event_id: "Ev1", event };

        const projected = projectSlackEvent(event, envelope, context);

        expect(projected).toMatchObject({
            type: "message",
            message_type: "channel",
            raw_event: envelope,
            message: [
                { type: "reply", data: { message_id: "1709999999.000001" } },
                { type: "text", data: { text: "hello" } },
                { type: "audio", data: { file: "F1", url: "https://files/1" } },
            ],
        });
    });

    it("投影消息删除与未知原生事件", () => {
        const deleted: SlackEvent = {
            type: "message",
            subtype: "message_deleted",
            event_ts: "1710000001.000001",
            deleted_ts: "1710000000.000001",
            channel: "C1",
        };
        expect(projectSlackEvent(deleted, { event: deleted }, context)).toMatchObject({
            type: "notice",
            notice_type: "message_deleted",
            message_id: { string: "1710000000.000001" },
        });

        const unknown: SlackEvent = { type: "canvas_updated", event_ts: "1710000002" };
        expect(projectSlackEvent(unknown, { event: unknown }, context)).toMatchObject({
            type: "notice",
            notice_type: "custom",
            extensions: { slack: { event_type: "canvas_updated" } },
        });
    });
});
