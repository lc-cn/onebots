import { MediaFileType, MsgType } from "@tencent-connect/qqbot-nodejs";
import { describe, expect, it } from "vitest";
import { QQApiError } from "./errors.js";
import { compileMessage } from "./messages.js";

describe("QQ 消息编译", () => {
    it("编译文本、提及、回复和媒体而不丢失平台语义", () => {
        const result = compileMessage([
            { type: "reply", data: { message_id: "m0" } },
            { type: "at", data: { qq: "u1" } },
            { type: "text", data: { text: " hello" } },
            { type: "image", data: { url: "https://example.com/a.png" } },
        ]);
        expect(result).toMatchObject({
            content: "<@u1> hello",
            replyId: "m0",
            media: [{ type: MediaFileType.IMAGE, source: "https://example.com/a.png" }],
        });
    });

    it("保留 Markdown 和键盘结构", () => {
        const result = compileMessage([
            { type: "markdown", data: { content: "# 标题" } },
            { type: "keyboard", data: { content: { rows: [] } } },
        ]);
        expect(result.advanced).toMatchObject({
            msgType: MsgType.MARKDOWN,
            markdown: { content: "# 标题" },
            keyboard: { content: { rows: [] } },
        });
    });

    it("拒绝静默丢弃未知消息段", () => {
        expect(() => compileMessage([{ type: "unknown", data: {} }])).toThrow(QQApiError);
    });
});
