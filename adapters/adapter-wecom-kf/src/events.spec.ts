import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectKfCallback, projectKfItem } from "./events.js";

const createId = (value: string | number): CommonTypes.Id => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});

describe("projectKfItem", () => {
    it("接待人员消息使用真实接待人员作为发送者", () => {
        const raw = {
            msgid: "m1",
            msgtype: "text",
            origin: 5,
            servicer_userid: "staff-1",
            external_userid: "customer-1",
            text: { content: "hello" },
        };
        expect(projectKfItem(raw, { botId: "bot", openKfId: "wk-1", createId })).toMatchObject({
            type: "message",
            sender: { id: { string: "staff-1" } },
            raw_event: raw,
            extensions: { wecom_kf: { external_userid: "customer-1" } },
        });
    });

    it("原生富消息和未知消息不再压成占位文本", () => {
        const link = projectKfItem(
            {
                msgid: "m2",
                msgtype: "link",
                origin: 3,
                external_userid: "customer",
                link: { title: "Docs", url: "https://example.com" },
            },
            { botId: "bot", openKfId: "wk-1", createId },
        );
        expect(link).toMatchObject({ message: [{ type: "link" }] });
        const unknown = projectKfItem(
            { msgid: "m3", msgtype: "future", origin: 7 },
            { botId: "bot", openKfId: "wk-1", createId },
        );
        expect(unknown).toMatchObject({ message: [{ type: "wecom_kf_message" }] });
    });

    it("事件条目完整投影为 custom notice", () => {
        const raw = {
            msgid: "event-1",
            msgtype: "event",
            event: {
                event_type: "enter_session",
                scene: "web",
                open_kfid: "wk-event",
                external_userid: "customer-event",
            },
        };
        expect(projectKfItem(raw, { botId: "bot", openKfId: "wk-1", createId })).toMatchObject({
            type: "notice",
            bot_id: { string: "wk-event" },
            notice_type: "custom",
            sub_type: "enter_session",
            user: { id: { string: "customer-event" } },
            extensions: {
                wecom_kf: {
                    open_kfid: "wk-event",
                    external_userid: "customer-event",
                },
            },
            raw_event: raw,
        });
    });

    it("回调投影移除仅供同步使用的凭证与明密文", () => {
        const event = projectKfCallback(
            {
                MsgType: "event",
                Event: "kf_msg_or_event",
                OpenKfId: "wk-1",
                Token: "sensitive-token",
                RawXml: "<xml>sensitive-token</xml>",
                EncryptedXml: "ciphertext",
            },
            { botId: "bot", createId },
        );

        expect(event.raw_event).toEqual({
            MsgType: "event",
            Event: "kf_msg_or_event",
            OpenKfId: "wk-1",
        });
        expect(event.bot_id).toMatchObject({ string: "wk-1" });
        expect(JSON.stringify(event)).not.toContain("sensitive-token");
        expect(JSON.stringify(event)).not.toContain("ciphertext");
    });
});
