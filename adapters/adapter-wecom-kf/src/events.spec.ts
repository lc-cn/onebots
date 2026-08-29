import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { projectKfItem } from "./events.js";

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
            event: { event_type: "enter_session", scene: "web" },
        };
        expect(projectKfItem(raw, { botId: "bot", openKfId: "wk-1", createId })).toMatchObject({
            type: "notice",
            notice_type: "custom",
            sub_type: "enter_session",
            raw_event: raw,
        });
    });
});
