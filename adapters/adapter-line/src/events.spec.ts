import type { webhook } from "@line/bot-sdk";
import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectLineEvent } from "./events.js";

const context = {
    botId: id("bot"),
    createId: (value: string | number) => id(String(value)),
};

function id(value: string): CommonTypes.Id {
    return { string: value, source: value, number: Number(value) };
}

describe("LINE 事件投影", () => {
    it("保留原始消息、回复和重投递信息", () => {
        const event = {
            type: "message",
            timestamp: 1,
            mode: "active",
            webhookEventId: "evt-1",
            deliveryContext: { isRedelivery: true },
            source: { type: "group", groupId: "G1", userId: "U1" },
            replyToken: "reply",
            message: {
                id: "M1",
                type: "text",
                text: "更新后",
                quotedMessageId: "M0",
                quoteToken: "quote",
            },
        } as webhook.MessageEvent;

        const result = projectLineEvent(event, context);
        expect(result?.raw_event).toBe(event);
        expect(result).toMatchObject({
            type: "message",
            message_type: "group",
            message_id: { string: "M1" },
            message: [
                { type: "reply", data: { message_id: "M0" } },
                { type: "text", data: { text: "更新后" } },
            ],
        });
    });

    it("投影编辑与撤回事件", () => {
        const base = {
            timestamp: 2,
            mode: "active" as const,
            deliveryContext: { isRedelivery: false },
            source: { type: "group" as const, groupId: "G1" },
        };
        expect(
            projectLineEvent(
                {
                    ...base,
                    type: "messageEdited",
                    webhookEventId: "evt-2",
                    message: { id: "M1", type: "text", text: "new", quoteToken: "quote" },
                },
                context,
            ),
        ).toMatchObject({
            notice_type: "message_updated",
            message_id: { string: "M1" },
            group: { id: { string: "G1" } },
        });
        expect(
            projectLineEvent(
                {
                    ...base,
                    type: "unsend",
                    webhookEventId: "evt-3",
                    unsend: { messageId: "M1" },
                },
                context,
            ),
        ).toMatchObject({
            notice_type: "message_deleted",
            message_id: { string: "M1" },
            group: { id: { string: "G1" } },
        });
    });

    it("将 LINE mention 位置投影为标准 at 段", () => {
        const result = projectLineEvent(
            {
                type: "message",
                timestamp: 3,
                mode: "active",
                webhookEventId: "evt-4",
                deliveryContext: { isRedelivery: false },
                source: { type: "group", groupId: "G1", userId: "U1" },
                message: {
                    id: "M2",
                    type: "text",
                    text: "Hi @all!",
                    quoteToken: "quote",
                    mention: { mentionees: [{ type: "all", index: 3, length: 4 }] },
                },
            },
            context,
        );
        expect(result).toMatchObject({
            message: [
                { type: "text", data: { text: "Hi " } },
                { type: "at", data: { user_id: "all", text: "@all" } },
                { type: "text", data: { text: "!" } },
            ],
        });
    });
});
