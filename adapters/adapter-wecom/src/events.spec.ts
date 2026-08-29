import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectWeComEvent } from "./events.js";

const createId = (value: string | number): CommonTypes.Id => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});

describe("projectWeComEvent", () => {
    it("投影企业微信文本回调并保留原始事件", () => {
        const raw = {
            MsgType: "text",
            MsgId: "message-1",
            CreateTime: 1_777_000_000,
            FromUserName: "user-1",
            Content: "hello",
        };
        const event = projectWeComEvent(raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "message",
            message_type: "private",
            raw_event: raw,
            raw_message: "hello",
        });
        expect(event.timestamp).toBe(1_777_000_000_000);
    });

    it("投影通讯录成员变更", () => {
        const event = projectWeComEvent(
            {
                MsgType: "event",
                Event: "change_contact",
                ChangeType: "create_user",
                UserID: "user-1",
            },
            { botId: "bot", createId },
        );
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "user_added",
            user: { id: { string: "user-1" } },
        });
    });

    it("未知事件仍以 custom notice 无损投影", () => {
        const raw = { MsgType: "event", Event: "batch_job_result", CreateTime: 1_777_000_000 };
        const event = projectWeComEvent(raw, { botId: "bot", createId });
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "custom",
            raw_event: raw,
            extensions: { wecom: { event_type: "batch_job_result" } },
        });
    });

    it("将菜单与模板卡片回调投影为统一交互事件", () => {
        const event = projectWeComEvent(
            {
                MsgType: "event",
                Event: "template_card_event",
                EventKey: "approve",
                ResponseCode: "response-1",
                CreateTime: 1_777_000_000,
                FromUserName: "user-1",
            },
            { botId: "bot", createId },
        );
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "interaction",
            sub_type: "template_card_event",
            user: { id: { string: "user-1" } },
            extensions: {
                wecom: { event_key: "approve", response_code: "response-1" },
            },
        });
    });
});
