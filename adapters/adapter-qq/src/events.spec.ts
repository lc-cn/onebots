import { describe, expect, it } from "vitest";
import { projectQQMessage, projectQQRawEvent } from "./events.js";

const createId = (value: string | number) => ({ string: String(value), source: value, number: 1 });
const context = { botId: createId("bot"), createId };

describe("QQ 事件投影", () => {
    it("完整投影群消息、提及、附件与原始事件", () => {
        const raw = {
            rawEventType: "GROUP_AT_MESSAGE_CREATE",
            kind: "group" as const,
            senderId: "u1",
            content: "你好",
            messageId: "m1",
            timestamp: "2026-08-29T00:00:00.000Z",
            groupOpenid: "g1",
            mentions: [{ member_openid: "u2" }],
            attachments: [{ content_type: "image/png", url: "https://example.com/a.png" }],
            raw: {} as never,
            replyTarget: { scope: "group" as const, targetId: "g1" },
        };
        const event = projectQQMessage(raw, context);
        expect(event.message_type).toBe("group");
        expect(event.group?.id.string).toBe("g1");
        expect(event.message.map(segment => segment.type)).toEqual(["at", "text", "image"]);
        expect(event.raw_event).toBe(raw.raw);
    });

    it("未知平台事件仍以 custom notice 无损下发", () => {
        const raw = { id: "e1", guild_id: "g1", future_field: 42 };
        const event = projectQQRawEvent("FUTURE_EVENT", raw, context);
        expect(event).toMatchObject({ type: "notice", notice_type: "custom", raw_event: raw });
    });

    it("频道消息分别保留 Guild 与 Channel 地址", () => {
        const platformEvent = { id: "m1", guild_id: "guild-1", channel_id: "channel-1" };
        const message = {
            rawEventType: "AT_MESSAGE_CREATE",
            kind: "guild" as const,
            senderId: "u1",
            senderName: "Alice",
            content: "你好",
            messageId: "m1",
            timestamp: "2026-08-29T00:00:00.000Z",
            guildId: "guild-1",
            channelId: "channel-1",
            raw: platformEvent as never,
        };

        expect(projectQQMessage(message, context)).toMatchObject({
            message_type: "channel",
            group: {
                id: { string: "channel-1" },
                guild_id: { string: "guild-1" },
                channel_id: { string: "channel-1" },
            },
            raw_event: platformEvent,
        });
    });

    it("频道私信从 SDK typed message 投影为 direct", () => {
        expect(
            projectQQMessage(
                {
                    rawEventType: "DIRECT_MESSAGE_CREATE",
                    kind: "dm" as const,
                    senderId: "u1",
                    content: "你好",
                    messageId: "m1",
                    timestamp: "2026-08-29T00:00:00.000Z",
                    guildId: "dm-guild-1",
                    raw: { id: "m1", guild_id: "dm-guild-1" } as never,
                },
                context,
            ),
        ).toMatchObject({
            message_type: "direct",
            sender: { id: { string: "u1" } },
            extensions: { qq: { guild_id: "dm-guild-1" } },
        });
    });

    it("加群申请投影为可处理 request", () => {
        const event = projectQQRawEvent(
            "GROUP_JOIN_REQUEST",
            { id: "e1", group_openid: "g1", member_openid: "u1", join_request_id: "r1" },
            context,
        );
        expect(event).toMatchObject({ type: "request", request_type: "group", flag: "r1" });
    });
});
