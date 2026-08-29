import { describe, expect, it } from "vitest";
import { compileICQQMessage, projectICQQMessageSegments } from "./messages.js";

describe("ICQQ 消息编译", () => {
    it("拒绝静默丢弃未知发送段", () => {
        expect(() => compileICQQMessage([{ type: "unknown", data: {} }])).toThrow(
            "ICQQ 不支持消息段 unknown",
        );
    });

    it("支持受控原生元素并保留未知接收元素", () => {
        expect(
            compileICQQMessage([{ type: "icqq", data: { element: { type: "poke", id: 1 } } }]),
        ).toEqual([{ type: "poke", id: 1 }]);
        expect(
            projectICQQMessageSegments([
                { type: "icqq_raw", data: { type: "markdown", content: "# title" } },
            ]),
        ).toEqual([
            {
                type: "icqq_raw",
                data: { element: { type: "markdown", content: "# title" } },
            },
        ]);
    });

    it("严格校验 Base64 媒体与整数 ID", () => {
        expect(() =>
            compileICQQMessage([{ type: "image", data: { file: "base64://***" } }]),
        ).toThrow("无效 Base64");
        expect(() => compileICQQMessage([{ type: "face", data: { id: "x" } }])).toThrow("安全整数");
    });
});
