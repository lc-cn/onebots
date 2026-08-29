import { describe, expect, it } from "vitest";
import { compileWeComMessages } from "./messages.js";

describe("compileWeComMessages", () => {
    it("保留文本、提及与媒体段顺序", () => {
        expect(
            compileWeComMessages([
                { type: "text", data: { text: "hello " } },
                { type: "at", data: { user_id: "u1" } },
                { type: "image", data: { file: "wecom://media/m1" } },
            ]),
        ).toEqual([
            { msgtype: "text", text: { content: "hello @u1" } },
            { msgtype: "image", image: { media_id: "m1" } },
        ]);
    });

    it("原生消息不能覆盖标准发送目标", () => {
        expect(
            compileWeComMessages([
                {
                    type: "wecom_message",
                    data: {
                        message: {
                            msgtype: "markdown",
                            touser: "forged",
                            markdown: { content: "ok" },
                        },
                    },
                },
            ])[0],
        ).toEqual({ msgtype: "markdown", markdown: { content: "ok" } });
    });

    it("拒绝把媒体 URL 降级为文字", () => {
        expect(() =>
            compileWeComMessages([{ type: "image", data: { url: "https://example.com/a.png" } }]),
        ).toThrowError(expect.objectContaining({ code: "WECOM_INVALID_MESSAGE" }));
    });
});
