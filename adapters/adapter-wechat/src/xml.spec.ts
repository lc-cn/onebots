import { describe, expect, it } from "vitest";
import { buildPassiveReply, parseIncomingMessage, parseWechatXml } from "./xml.js";

const xml = `<xml><ToUserName><![CDATA[bot]]></ToUserName><FromUserName><![CDATA[user]]></FromUserName><CreateTime>123</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello]]></Content><MsgId>9</MsgId></xml>`;

describe("微信公众号 XML", () => {
    it("解析标准消息并保留未知字段", () => {
        expect(parseIncomingMessage(xml)).toMatchObject({
            ToUserName: "bot",
            FromUserName: "user",
            CreateTime: 123,
            MsgType: "text",
            Content: "hello",
            MsgId: "9",
        });
    });

    it("拒绝 DTD 和实体声明", () => {
        expect(() =>
            parseWechatXml(`<!DOCTYPE xml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><xml></xml>`),
        ).toThrowError(expect.objectContaining({ code: "WECHAT_UNSAFE_XML" }));
    });

    it("生成可关联原始收发方的被动回复", () => {
        expect(
            buildPassiveReply(parseIncomingMessage(xml), {
                msgtype: "text",
                text: { content: "world" },
            }),
        ).toContain("<ToUserName><![CDATA[user]]></ToUserName>");
    });
});
