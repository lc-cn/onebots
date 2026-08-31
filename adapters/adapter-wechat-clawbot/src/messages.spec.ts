import { describe, expect, it } from "vitest";
import { compileWechatClawbotMessage } from "./messages.js";

describe("微信 ClawBot 消息编译", () => {
    it("保留顺序并支持标准媒体来源与元数据", () => {
        expect(
            compileWechatClawbotMessage([
                { type: "text", data: { text: "说明" } },
                {
                    type: "file",
                    data: {
                        data: "aGVsbG8=",
                        name: "hello.txt",
                        content_type: "text/plain",
                        summary: "附件",
                    },
                },
            ]),
        ).toEqual([
            { kind: "text", text: "说明" },
            {
                kind: "file",
                input: "base64://aGVsbG8=",
                options: {
                    caption: "附件",
                    filename: "hello.txt",
                    contentType: "text/plain",
                },
            },
        ]);
    });

    it("拒绝歧义来源、入站加密句柄和全空消息", () => {
        expect(() =>
            compileWechatClawbotMessage([
                { type: "image", data: { url: "https://example.test/a", path: "/a" } },
            ]),
        ).toThrow("必须且只能提供");
        expect(() =>
            compileWechatClawbotMessage([{ type: "image", data: { file_id: "encrypted-handle" } }]),
        ).toThrow("download_media");
        expect(() => compileWechatClawbotMessage([{ type: "text", data: { text: "" } }])).toThrow(
            "不能全部为空",
        );
    });

    it("拒绝未知段和错误字段类型", () => {
        expect(() => compileWechatClawbotMessage([{ type: "reply", data: { id: "1" } }])).toThrow(
            "不支持消息段",
        );
        expect(() => compileWechatClawbotMessage([{ type: "video", data: { url: 42 } }])).toThrow(
            "video.url 必须是字符串",
        );
    });
});
