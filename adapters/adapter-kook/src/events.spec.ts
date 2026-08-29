import { describe, expect, test } from "vitest";
import { projectKookEvent } from "./events.js";
import type { KookEvent, KookSignal } from "./types.js";

const id = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value),
});
const context = { botId: id("bot"), createId: id };

describe("KOOK 事件投影", () => {
    test("频道消息使用频道作为统一 scene 并保留服务器 ID", () => {
        const event = messageEvent();
        const signal: KookSignal = { s: 0, sn: 2, d: event };
        const projected = projectKookEvent(event, signal, context);
        expect(projected).toMatchObject({
            type: "message",
            message_type: "channel",
            group: {
                id: { string: "channel-1" },
                guild_id: { string: "guild-1" },
                channel_id: { string: "channel-1" },
            },
            extensions: { kook: { guild_id: "guild-1" } },
            raw_event: { signal: { sn: 2 } },
        });
    });

    test("私聊回应删除投影为 reaction_removed", () => {
        const event: KookEvent = {
            ...messageEvent(),
            type: 255,
            channel_type: "PERSON",
            extra: {
                type: "private_deleted_reaction",
                body: { user_id: "user-2", msg_id: "message-2", emoji: { name: "👍" } },
            },
        };
        const projected = projectKookEvent(event, { s: 0, d: event }, context);
        expect(projected).toMatchObject({
            type: "notice",
            notice_type: "reaction_removed",
            user: { id: { string: "user-2" } },
            message_id: { string: "message-2" },
        });
    });

    test("未知系统事件不会丢失", () => {
        const event: KookEvent = {
            ...messageEvent(),
            type: 255,
            extra: { type: "future_event", body: { future: true } },
        };
        expect(projectKookEvent(event, { s: 0, d: event }, context)).toMatchObject({
            type: "notice",
            notice_type: "custom",
            extensions: { kook: { event_type: "future_event", body: { future: true } } },
        });
    });
});

function messageEvent(): KookEvent {
    return {
        channel_type: "GROUP",
        type: 9,
        target_id: "channel-1",
        author_id: "user-1",
        content: "hello",
        msg_id: "message-1",
        msg_timestamp: 1_700_000_000_000,
        extra: {
            guild_id: "guild-1",
            channel_name: "general",
            author: { id: "user-1", username: "Alice" },
        },
    };
}
