import { describe, expect, it } from "vitest";
import { projectDingTalkEvents, projectDingTalkRobotMessage } from "./events.js";
import type { DingTalkEvent, DingTalkRobotMessage } from "./types.js";

const context = {
    botId: { string: "BOT" } as never,
    createId: (value: string | number) => ({ string: String(value) }) as never,
};

describe("DingTalk event projection", () => {
    it("按真实 Stream 机器人载荷投影会话、发送者、@ 和 raw_event", () => {
        const message: DingTalkRobotMessage = {
            conversationId: "cid_group",
            conversationType: "2",
            conversationTitle: "项目群",
            chatbotUserId: "bot_id",
            msgId: "msg_1",
            msgtype: "text",
            createAt: 1710000000000,
            senderId: "ding_sender",
            senderStaffId: "user_1",
            senderNick: "用户",
            text: { content: "你好" },
            atUsers: [{ staffId: "user_2" }],
        };
        const raw = { type: "CALLBACK", data: message };
        expect(projectDingTalkRobotMessage(message, raw, context)).toMatchObject({
            type: "message",
            message_type: "group",
            sender: { id: { string: "user_1" }, name: "用户" },
            group: { id: { string: "cid_group" }, name: "项目群" },
            raw_event: raw,
            message: [
                { type: "text", data: { text: "你好" } },
                { type: "at", data: { user_id: "user_2" } },
            ],
        });
    });

    it("投影通讯录事件并无损保留未知事件", () => {
        expect(projectDingTalkEvents(makeEvent("user_add_org"), context)[0]).toMatchObject({
            notice_type: "user_added",
            user: { id: { string: "user_1" } },
        });
        expect(projectDingTalkEvents(makeEvent("bpms_instance_change"), context)[0]).toMatchObject({
            notice_type: "custom",
            extensions: { dingtalk: { event_type: "bpms_instance_change" } },
        });
    });

    it("将批量群成员回调逐成员投影并保留操作者", () => {
        const event = makeEvent("chat_add_member", {
            UserId: ["user_1", "user_2"],
            OpenConversationId: "cid_group",
            Title: "项目群",
            Operator: "admin_1",
        });
        expect(projectDingTalkEvents(event, context)).toMatchObject([
            {
                id: { string: "event:chat_add_member:user_1" },
                notice_type: "member_joined",
                user: { id: { string: "user_1" } },
                operator: { id: { string: "admin_1" } },
                group: { id: { string: "cid_group" }, name: "项目群" },
            },
            {
                id: { string: "event:chat_add_member:user_2" },
                notice_type: "member_joined",
                user: { id: { string: "user_2" } },
            },
        ]);
    });
});

function makeEvent(
    eventType: string,
    eventData: Record<string, unknown> = { UserId: ["user_1"] },
): DingTalkEvent {
    const raw = { eventType, ...eventData };
    return {
        eventType,
        eventId: `event:${eventType}`,
        eventTime: 1710000000000,
        eventData: raw,
        raw,
    };
}
