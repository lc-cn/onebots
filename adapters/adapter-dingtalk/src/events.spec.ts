import { describe, expect, it } from "vitest";
import { projectDingTalkEvent, projectDingTalkRobotMessage } from "./events.js";
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
        expect(projectDingTalkEvent(makeEvent("user_add_org"), context)).toMatchObject({
            notice_type: "user_added",
            user: { id: { string: "user_1" } },
        });
        expect(projectDingTalkEvent(makeEvent("bpms_instance_change"), context)).toMatchObject({
            notice_type: "custom",
            extensions: { dingtalk: { event_type: "bpms_instance_change" } },
        });
    });
});

function makeEvent(eventType: string): DingTalkEvent {
    const raw = { eventType, UserId: ["user_1"] };
    return {
        eventType,
        eventId: `event:${eventType}`,
        eventTime: 1710000000000,
        eventData: raw,
        raw,
    };
}
