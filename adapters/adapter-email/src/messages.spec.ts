import { describe, expect, it } from "vitest";
import { compileEmailMessage, createEmailSendOptions } from "./messages.js";

describe("compileEmailMessage", () => {
    it("编译文本、线程头、原生字段和内联图片", () => {
        const compiled = compileEmailMessage([
            { type: "email", data: { subject: "主题", cc: ["cc@example.com"], priority: "high" } },
            { type: "reply", data: { message_id: "<parent@example.com>" } },
            { type: "text", data: { text: "<hello>\nworld" } },
            {
                type: "image",
                data: { name: "logo.png", url: "https://example.com/logo.png" },
            },
        ]);

        expect(compiled.subject).toBe("主题");
        expect(compiled.in_reply_to).toBe("<parent@example.com>");
        expect(compiled.text).toBe("<hello>\nworld");
        expect(compiled.html).toContain("&lt;hello&gt;<br>world");
        expect(compiled.html).toContain("cid:onebots-");
        expect(compiled.attachments?.[0]).toMatchObject({
            filename: "logo.png",
            href: "https://example.com/logo.png",
            disposition: "inline",
        });
    });

    it("拒绝静默丢弃未知消息段", () => {
        expect(() => compileEmailMessage([{ type: "audio", data: { url: "x" } }])).toThrow(
            "邮件不支持消息段 audio",
        );
    });

    it("原生主题覆盖默认主题", () => {
        const result = createEmailSendOptions(
            ["user@example.com"],
            "默认主题",
            compileEmailMessage([{ type: "email", data: { subject: "指定主题" } }]),
        );
        expect(result.subject).toBe("指定主题");
    });
});
