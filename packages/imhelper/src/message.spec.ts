import { describe, expect, test } from "vitest";
import { Message } from "./message.js";

describe("Message", () => {
    test("normalizes text and individual segments for array-based protocols", () => {
        expect(Message.toSegments("你好")).toEqual([{ type: "text", data: { text: "你好" } }]);

        const image: Message.Segment = { type: "image", data: { url: "https://example.test/a" } };
        expect(Message.toSegments(image)).toEqual([image]);
        expect(Message.toSegments([image])).toEqual([image]);
    });
});
