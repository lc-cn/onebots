import { describe, expect, it } from "vitest";
import { compileWechatMessages } from "./messages.js";

describe("compileWechatMessages", () => {
    it("保留段顺序并关联被动回复事件", () => {
        expect(
            compileWechatMessages([
                { type: "reply", data: { message_id: "event-1" } },
                { type: "text", data: { text: "hello" } },
                { type: "image", data: { file: "wechat://media/media-1" } },
            ]),
        ).toEqual({
            replyEventId: "event-1",
            messages: [
                { msgtype: "text", text: { content: "hello" } },
                { msgtype: "image", image: { media_id: "media-1" } },
            ],
        });
    });

    it("拒绝把任意图片 URL 伪装成文本发送", () => {
        expect(() =>
            compileWechatMessages([{ type: "image", data: { url: "https://example.com/a.png" } }]),
        ).toThrowError(expect.objectContaining({ code: "WECHAT_INVALID_MESSAGE" }));
    });

    it("允许完整原生消息透传", () => {
        expect(
            compileWechatMessages([
                {
                    type: "wechat_message",
                    data: { message: { msgtype: "wxcard", wxcard: { card_id: "c1" } } },
                },
            ]).messages[0],
        ).toEqual({ msgtype: "wxcard", wxcard: { card_id: "c1" } });
    });
});
