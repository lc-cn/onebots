import { describe, expect, test } from "vitest";
import { decodeSatoriContent, encodeSatoriContent } from "./message-codec.js";

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

    test("rejects malformed native elements", () => {
        expect(() => decodeSatoriContent([{ attrs: {} }])).toThrowError(
            expect.objectContaining({
                name: "ProtocolError",
                operation: "event.message.content[0]",
            }),
        );
    });
});
