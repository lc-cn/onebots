import { describe, expect, it } from "vitest";
import { compileMilkySegments, projectMilkySegments } from "./message-segments.js";

describe("Milky 消息段 codec", () => {
    it("将 canonical 发送段编译为通用消息段", () => {
        expect(
            compileMilkySegments([
                { type: "text", data: { text: "hello" } },
                { type: "mention", data: { user_id: 10001 } },
                { type: "mention_all", data: {} },
                { type: "face", data: { face_id: "66" } },
                { type: "image", data: { uri: "https://example.com/image.png" } },
                { type: "light_app", data: { json_payload: "{}" } },
            ]),
        ).toEqual([
            { type: "text", data: { text: "hello" } },
            { type: "at", data: { qq: 10001 } },
            { type: "at", data: { qq: "all" } },
            { type: "face", data: { id: "66", is_large: false } },
            {
                type: "image",
                data: { file: "https://example.com/image.png", asface: false },
            },
            { type: "json", data: { data: "{}" } },
        ]);
    });

    it("拒绝未知发送段而不是静默丢失", () => {
        expect(() => compileMilkySegments([{ type: "forward", data: { messages: [] } }])).toThrow(
            "暂不支持发送 Milky 消息段 forward",
        );
    });

    it("保留超级表情、贴纸与映射后的引用消息 ID", () => {
        expect(
            compileMilkySegments(
                [
                    { type: "face", data: { face_id: "66", is_large: true } },
                    {
                        type: "image",
                        data: { uri: "base64://aGVsbG8=", sub_type: "sticker", summary: "[贴纸]" },
                    },
                    { type: "reply", data: { message_seq: 42 } },
                ],
                sequence => `mapped-${sequence}`,
            ),
        ).toEqual([
            { type: "face", data: { id: "66", is_large: true } },
            {
                type: "image",
                data: { file: "base64://aGVsbG8=", asface: true, summary: "[贴纸]" },
            },
            { type: "reply", data: { id: "mapped-42", message_seq: 42 } },
        ]);
    });

    it("将通用段与 ICQQ 原生扩展投影为 canonical 接收段", () => {
        expect(
            projectMilkySegments([
                { type: "at", data: { qq: 10001, text: "Alice" } },
                {
                    type: "image",
                    data: {
                        file: "resource",
                        url: "https://example.com/image.png",
                        width: 320,
                        height: 240,
                    },
                },
                {
                    type: "icqq_raw",
                    data: { element: { type: "markdown", content: "# title" } },
                },
                { type: "unsupported", data: { raw: true } },
            ]),
        ).toEqual([
            { type: "mention", data: { user_id: 10001, name: "Alice" } },
            {
                type: "image",
                data: {
                    resource_id: "resource",
                    temp_url: "https://example.com/image.png",
                    width: 320,
                    height: 240,
                    summary: "",
                    sub_type: "normal",
                },
            },
            { type: "markdown", data: { content: "# title" } },
        ]);
    });
});
