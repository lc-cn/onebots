import { describe, expect, test } from "vitest";
import {
    createSatoriEmojiElement,
    decodeSatoriContent,
    encodeSatoriContent,
    renderSatoriEmoji,
} from "./message-codec.js";

describe("Satori message codec", () => {
    test("round-trips native elements through canonical message segments", () => {
        const decoded = decodeSatoriContent([
            { type: "text", attrs: { text: "hello" } },
            { type: "img", attrs: { src: "https://example.test/image.png" } },
        ]);

        expect(decoded).toEqual([
            { type: "text", data: { text: "hello" } },
            { type: "img", data: { src: "https://example.test/image.png" } },
        ]);
        expect(encodeSatoriContent(decoded)).toEqual([
            { type: "text", attrs: { text: "hello" } },
            { type: "img", attrs: { src: "https://example.test/image.png" } },
        ]);
    });

    test("preserves nested formatting children without leaking them into attrs", () => {
        const native = [
            {
                type: "b",
                attrs: { class: "important" },
                children: ["hello", { type: "i", children: [" world"] }],
            },
        ];

        const decoded = decodeSatoriContent(native);

        expect(decoded).toEqual([
            {
                type: "b",
                data: {
                    class: "important",
                    $children: [
                        { type: "text", data: { text: "hello" } },
                        {
                            type: "i",
                            data: {
                                $children: [{ type: "text", data: { text: " world" } }],
                            },
                        },
                    ],
                },
            },
        ]);
        expect(encodeSatoriContent(decoded)).toEqual([
            {
                type: "b",
                attrs: { class: "important" },
                children: [
                    { type: "text", attrs: { text: "hello" } },
                    {
                        type: "i",
                        children: [{ type: "text", attrs: { text: " world" } }],
                    },
                ],
            },
        ]);
    });

    test("decodes emoji markup and round-trips the emoji element", () => {
        const decoded = decodeSatoriContent(
            'hello <emoji id="twemoji:smile" name="smile"/> <emoji name="wave"></emoji>',
        );

        expect(decoded).toEqual([
            { type: "text", data: { text: "hello " } },
            { type: "emoji", data: { id: "twemoji:smile", name: "smile" } },
            { type: "text", data: { text: " " } },
            { type: "emoji", data: { name: "wave" } },
        ]);
        expect(encodeSatoriContent(decoded)).toEqual([
            { type: "text", attrs: { text: "hello " } },
            { type: "emoji", attrs: { id: "twemoji:smile", name: "smile" } },
            { type: "text", attrs: { text: " " } },
            { type: "emoji", attrs: { name: "wave" } },
        ]);
        expect(decodeSatoriContent("plain")).toBe("plain");
        expect(renderSatoriEmoji({ id: 'a>"b', name: "smile" })).toBe(
            '<emoji id="a&gt;&quot;b" name="smile"/>',
        );
        expect(decodeSatoriContent(renderSatoriEmoji({ id: 'a>"b', name: "smile" }))).toEqual([
            { type: "emoji", data: { id: 'a>"b', name: "smile" } },
        ]);
        expect(createSatoriEmojiElement({ id: "1" })).toEqual({
            type: "emoji",
            attrs: { id: "1" },
        });
    });

    test("rejects emoji attributes that are not strings", () => {
        expect(() => decodeSatoriContent([{ type: "emoji", attrs: { id: 1 } }])).toThrowError(
            expect.objectContaining({
                name: "ProtocolError",
                operation: "event.message.content[0].id",
            }),
        );
    });

    test("rejects malformed native elements", () => {
        expect(() => decodeSatoriContent([{ attrs: {} }])).toThrowError(
            expect.objectContaining({
                name: "ProtocolError",
                operation: "event.message.content[0]",
            }),
        );
    });
});
