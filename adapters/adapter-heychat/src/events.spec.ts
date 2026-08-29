import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectHeychatEvent } from "./events.js";
import type { HeychatWsEnvelope } from "./types.js";

const createId = (value: string | number): CommonTypes.Id => ({
    string: String(value),
    source: value,
    number: Number(value) || 0,
});

function envelope(type: string, data: Record<string, unknown>): HeychatWsEnvelope {
    return { sequence: 7, type, data, timestamp: 1_728_455_000_000 };
}

describe("projectHeychatEvent", () => {
    it("将 type=50 斜杠命令投影为频道消息并保留原始事件", () => {
        const raw = envelope("50", {
            bot_id: 99,
            msg_id: "m1",
            send_time: 1_728_455_000_001,
            room_base_info: { room_id: "r1", room_name: "房间" },
            channel_base_info: { channel_id: "c1", channel_name: "频道", channel_type: 1 },
            sender_info: { user_id: 42, nickname: "用户" },
            command_info: {
                id: "cmd",
                name: "/ping",
                options: [{ name: "text", type: 3, value: "pong" }],
            },
        });
        const event = projectHeychatEvent(raw, { accountId: "bot", createId });

        expect(event).toMatchObject({
            type: "message",
            message_type: "channel",
            raw_message: "/ping pong",
            group: { id: { string: "r1:c1" } },
            sender: { id: { string: "42" } },
            raw_event: raw,
        });
    });

    it("投影回应、成员变更与卡片按钮事件", () => {
        const reaction = projectHeychatEvent(
            envelope("5003", {
                channel_id: "c1",
                msg_id: "m1",
                user_id: 42,
                emoji: "[cube_doge]",
                is_add: 1,
            }),
            {
                accountId: "bot",
                createId,
                getChannelContext: () => ({ room_id: "r1", channel_id: "c1" }),
            },
        );
        expect(reaction).toMatchObject({
            type: "notice",
            notice_type: "reaction_added",
            group: { id: { string: "r1:c1" } },
        });

        const member = projectHeychatEvent(
            envelope("3001", {
                state: 0,
                room_base_info: { room_id: "r1", room_name: "房间" },
                user_info: { user_id: 42, nickname: "用户" },
            }),
            { accountId: "bot", createId },
        );
        expect(member).toMatchObject({ type: "notice", notice_type: "member_left" });

        const interaction = projectHeychatEvent(
            envelope("card_message_btn_click", { msg_id: "m1", value: "confirm" }),
            { accountId: "bot", createId },
        );
        expect(interaction).toMatchObject({ type: "notice", notice_type: "interaction" });
    });

    it("未知推送作为 custom 无损交付", () => {
        const raw = envelope("future_event", { nested: { value: true } });
        expect(projectHeychatEvent(raw, { accountId: "bot", createId })).toMatchObject({
            type: "notice",
            notice_type: "custom",
            raw_event: raw,
            extensions: { heychat: { event_type: "future_event" } },
        });
    });
});
