import type { webhook } from "@line/bot-sdk";
import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectLineEvents } from "./events.js";

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
                markAsReadToken: "read",
            },
        } as webhook.MessageEvent;

        const [result] = projectLineEvents(event, context);
        expect(result?.raw_event).toBe(event);
        expect(result).toMatchObject({
            type: "message",
            message_type: "group",
            message_id: { string: "M1" },
            message: [
                { type: "reply", data: { message_id: "M0" } },
                { type: "text", data: { text: "更新后" } },
            ],
            extensions: { line: { quote_token: "quote", mark_as_read_token: "read" } },
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
            projectLineEvents(
                {
                    ...base,
                    type: "messageEdited",
                    webhookEventId: "evt-2",
                    message: { id: "M1", type: "text", text: "new", quoteToken: "quote" },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "message_updated",
            message_id: { string: "M1" },
            group: { id: { string: "G1" } },
        });
        expect(
            projectLineEvents(
                {
                    ...base,
                    type: "unsend",
                    webhookEventId: "evt-3",
                    unsend: { messageId: "M1" },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "message_deleted",
            message_id: { string: "M1" },
            group: { id: { string: "G1" } },
        });
    });

    it("将 LINE mention 位置投影为标准 at 段", () => {
        const [result] = projectLineEvents(
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

    it("投影机器人加入和离开会话，并使用真实机器人身份", () => {
        for (const type of ["join", "leave"] as const) {
            const [result] = projectLineEvents(
                {
                    type,
                    timestamp: 4,
                    mode: "active",
                    webhookEventId: `evt-${type}`,
                    deliveryContext: { isRedelivery: false },
                    source: { type: "group", groupId: "G1" },
                    ...(type === "join" ? { replyToken: "reply" } : {}),
                } as webhook.JoinEvent | webhook.LeaveEvent,
                context,
            );
            expect(result).toMatchObject({
                notice_type: type === "join" ? "group_increase" : "group_decrease",
                user: { id: { string: "bot" } },
                group: { id: { string: "G1" } },
            });
        }
    });

    it("将批量成员变更拆成独立且 ID 稳定的 typed notice", () => {
        const results = projectLineEvents(
            {
                type: "memberJoined",
                timestamp: 5,
                mode: "active",
                webhookEventId: "evt-members",
                deliveryContext: { isRedelivery: false },
                source: { type: "group", groupId: "G1" },
                replyToken: "reply",
                joined: {
                    members: [
                        { type: "user", userId: "U1" },
                        { type: "user", userId: "U2" },
                    ],
                },
            },
            context,
        );
        expect(results).toHaveLength(2);
        expect(results).toMatchObject([
            {
                id: { string: "evt-members:U1" },
                notice_type: "member_joined",
                user: { id: { string: "U1" } },
            },
            {
                id: { string: "evt-members:U2" },
                notice_type: "member_joined",
                user: { id: { string: "U2" } },
            },
        ]);
    });
});
