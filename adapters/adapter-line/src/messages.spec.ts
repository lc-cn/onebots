import { describe, expect, it } from "vitest";
import { chunkLineMessages, compileLineMessages } from "./messages.js";

describe("LINE 消息编译", () => {
    it("将提及编译为 textV2 substitution", () => {
        expect(
            compileLineMessages([
                { type: "text", data: { text: "你好 " } },
                { type: "at", data: { user_id: "U123" } },
            ]),
        ).toEqual([
            {
                type: "textV2",
                text: "你好 {mention0}",
                substitution: {
                    mention0: { type: "mention", mentionee: { type: "user", userId: "U123" } },
                },
            },
        ]);
    });

    it("保留任意官方原生消息", () => {
        const flex = { type: "flex", altText: "订单", contents: { type: "bubble" } };
        expect(compileLineMessages([{ type: "line_message", data: { message: flex } }])).toEqual([
            flex,
        ]);
    });

    it("按官方每次五条消息限制分批", () => {
        const messages = Array.from({ length: 11 }, (_, index) => ({
            type: "text" as const,
            text: String(index),
        }));
        expect(chunkLineMessages(messages).map(chunk => chunk.length)).toEqual([5, 5, 1]);
    });

    it("将 quote token 绑定到下一条 Sticker", () => {
        expect(
            compileLineMessages([
                { type: "reply", data: { quote_token: "quote" } },
                { type: "sticker", data: { id: "1:2" } },
            ]),
        ).toEqual([{ type: "sticker", packageId: "1", stickerId: "2", quoteToken: "quote" }]);
    });

    it("未知消息段显式失败而不是静默丢失", () => {
        expect(() =>
            compileLineMessages([
                { type: "text", data: { text: "known" } },
                { type: "unknown", data: {} },
            ]),
        ).toThrow("不支持消息段 unknown");
    });
});
