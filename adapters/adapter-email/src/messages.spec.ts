import { describe, expect, it } from "vitest";
import { createImapMessageId } from "./message-id.js";
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
        expect(compiled.references).toEqual(["<parent@example.com>"]);
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

    it("显式 HTML 优先，并拒绝歧义 reply 与 Header 注入", () => {
        expect(
            compileEmailMessage([
                { type: "text", data: { text: "纯文本" } },
                { type: "email", data: { html: "<strong>HTML</strong>" } },
            ]).html,
        ).toBe("<strong>HTML</strong>");
        expect(() =>
            compileEmailMessage([
                { type: "reply", data: { message_id: "<one@example.com>" } },
                { type: "reply", data: { message_id: "<two@example.com>" } },
            ]),
        ).toThrow("只能包含一个 reply");
        expect(() =>
            compileEmailMessage([
                {
                    type: "email",
                    data: { headers: { "X-Test": "safe\r\nBcc: victim@example.com" } },
                },
            ]),
        ).toThrow("email.headers.X-Test");
    });

    it("拒绝无效的原生优先级", () => {
        expect(() =>
            compileEmailMessage([
                { type: "email", data: { priority: "urgent" } },
                { type: "text", data: { text: "body" } },
            ]),
        ).toThrowError(expect.objectContaining({ code: "EMAIL_INVALID_SEGMENT" }));
    });

    it("拒绝把无 RFC Message-ID 的 IMAP 标识伪装成线程头", () => {
        const messageId = createImapMessageId("INBOX", 42);
        expect(() =>
            compileEmailMessage([{ type: "reply", data: { message_id: messageId } }]),
        ).toThrowError(expect.objectContaining({ code: "EMAIL_THREAD_ID_UNAVAILABLE" }));
    });
});
