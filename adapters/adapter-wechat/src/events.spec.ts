import { describe, expect, it } from "vitest";
import { projectWechatEvent } from "./events.js";
import type { WechatIncomingMessage } from "./types.js";

const createId = (value: string | number) => ({
    string: String(value),
    number: Number(value) || 0,
    source: value,
});
const context = { botId: createId("bot"), createId };

describe("projectWechatEvent", () => {
    it("投影语音识别结果并保留原始事件", () => {
        const raw: WechatIncomingMessage = {
            ToUserName: "bot",
            FromUserName: "user",
            CreateTime: 10,
            MsgType: "voice",
            MsgId: "m1",
            MediaId: "media",
            Recognition: "你好",
        };
        const event = projectWechatEvent(raw, context);
        expect(event).toMatchObject({
            type: "message",
            timestamp: 10000,
            raw_event: raw,
            message: [{ type: "voice", data: { media_id: "media", recognition: "你好" } }],
        });
    });

    it("将关注投影为 friend_add，其他事件保留精确 sub_type", () => {
        const raw: WechatIncomingMessage = {
            ToUserName: "bot",
            FromUserName: "user",
            CreateTime: 10,
            MsgType: "event",
            Event: "subscribe",
            EventKey: "qrscene_1",
        };
        expect(projectWechatEvent(raw, context)).toMatchObject({
            type: "notice",
            notice_type: "friend_add",
            sub_type: "subscribe",
            extensions: { wechat: { event_key: "qrscene_1" } },
        });
    });

    it.each([
        ["unsubscribe", "friend_remove"],
        ["CLICK", "interaction"],
        ["TEMPLATESENDJOBFINISH", "message_status"],
    ])("将微信事件 %s 投影为统一通知 %s", (wechatEvent, noticeType) => {
        const raw: WechatIncomingMessage = {
            ToUserName: "bot",
            FromUserName: "user",
            CreateTime: 10,
            MsgType: "event",
            Event: wechatEvent,
            MsgID: "status-message",
            Status: "success",
        };
        expect(projectWechatEvent(raw, context)).toMatchObject({
            type: "notice",
            notice_type: noticeType,
            sub_type: wechatEvent.toLowerCase(),
            message_id: { string: "status-message" },
        });
    });

    it("完整保留模板与群发结果，并使用传入的真实公众号身份", () => {
        const raw: WechatIncomingMessage = {
            ToUserName: "gh_original",
            FromUserName: "user",
            CreateTime: 10,
            MsgType: "event",
            Event: "MASSSENDJOBFINISH",
            MsgID: "status-message",
            Status: "send success",
            TotalCount: 10,
            FilterCount: 1,
            SentCount: 8,
            ErrorCount: 1,
            ErrorCode: "0",
            CopyrightCheckResult: { Count: 0 },
        };
        expect(projectWechatEvent(raw, { ...context, botId: createId("wx-app") })).toMatchObject({
            bot_id: { string: "wx-app" },
            notice_type: "message_status",
            message_id: { string: "status-message" },
            extensions: {
                wechat: {
                    error_code: "0",
                    total_count: 10,
                    filter_count: 1,
                    sent_count: 8,
                    error_count: 1,
                    copyright_check_result: { Count: 0 },
                },
            },
        });
    });
});
