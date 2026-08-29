import { describe, expect, test } from "vitest";
import { buildKookOutboundMessage, projectKookMessageSegments } from "./messages.js";

describe("KOOK 消息编译", () => {
    test("单媒体使用原生消息类型并保留回复", () => {
        expect(
            buildKookOutboundMessage([
                { type: "reply", data: { message_id: "source" } },
                { type: "image", data: { url: "https://example.com/a.png" } },
            ]),
        ).toEqual({ type: 2, content: "https://example.com/a.png", quote: "source" });
    });

    test("混合富媒体编译为 Card 而不是 URL 文本", () => {
        const result = buildKookOutboundMessage([
            { type: "text", data: { text: "说明" } },
            { type: "image", data: { url: "https://example.com/a.png" } },
            { type: "file", data: { url: "https://example.com/a.pdf", name: "a.pdf" } },
        ]);
        expect(result.type).toBe(10);
        expect(JSON.parse(result.content)).toMatchObject([
            {
                type: "card",
                modules: [
                    { type: "section" },
                    { type: "container" },
                    { type: "file", title: "a.pdf" },
                ],
            },
        ]);
    });

    test("接收时保留 Card 结构与媒体类型", () => {
        const content = JSON.stringify([{ type: "card", modules: [] }]);
        expect(projectKookMessageSegments(10, content)[0]).toEqual({
            type: "card",
            data: { content, cards: [{ type: "card", modules: [] }] },
        });
        expect(projectKookMessageSegments(8, "https://example.com/a.mp3")[0]?.type).toBe("audio");
    });
});
