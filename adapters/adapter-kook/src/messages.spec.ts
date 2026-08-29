import { describe, expect, test, vi } from "vitest";
import {
    assertKookEditableMessage,
    buildKookOutboundMessage,
    prepareKookOutboundMessage,
    projectKookMessageSegments,
} from "./messages.js";

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

    test("发送前把 Base64 媒体上传为当前机器人的 KOOK 素材", async () => {
        const upload = vi.fn().mockResolvedValue("https://img.kookapp.cn/asset.png");
        const result = await prepareKookOutboundMessage(
            [
                {
                    type: "image",
                    data: { file: "base64://aW1hZ2U=", name: "image.png" },
                },
            ],
            upload,
        );
        expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), "image.png", "image/png");
        expect(result).toEqual({ type: 2, content: "https://img.kookapp.cn/asset.png" });
    });

    test("只允许更新 KMarkdown 与 Card", () => {
        expect(() =>
            assertKookEditableMessage([
                { type: "image", data: { url: "https://img.kookapp.cn/a.png" } },
            ]),
        ).toThrow("只支持更新 KMarkdown 或 Card");
        expect(() =>
            assertKookEditableMessage([{ type: "text", data: { text: "new" } }]),
        ).not.toThrow();
    });
});
