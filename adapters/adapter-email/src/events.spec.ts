import { describe, expect, it } from "vitest";
import { parseEmailSource, projectEmailEvent } from "./events.js";

describe("email event projection", () => {
    it("保留线程、附件和 reply-all 场景", async () => {
        const source = Buffer.from(
            [
                "Message-ID: <message@example.com>",
                "In-Reply-To: <parent@example.com>",
                "From: Alice <alice@example.com>",
                "To: Bot <bot@example.com>, Bob <bob@example.com>",
                "Cc: Carol <carol@example.com>",
                "Subject: Hello",
                "Date: Fri, 29 Aug 2026 10:00:00 +0800",
                "Content-Type: text/plain; charset=utf-8",
                "",
                "正文",
            ].join("\r\n"),
        );
        const email = await parseEmailSource(42, "INBOX", source);
        const event = projectEmailEvent(email, {
            accountId: id("account"),
            ownAddress: "bot@example.com",
            createId: id,
        });

        expect(email.id).toBe("<message@example.com>");
        expect(email.in_reply_to).toBe("<parent@example.com>");
        expect(event.message_type).toBe("direct");
        expect(event.message_id.string).toBe("<message@example.com>");
        expect(event.sender.id.string).toBe("alice@example.com");
        expect(event.extensions?.email).toMatchObject({ uid: 42, mailbox: "INBOX" });
    });

    it("仅 HTML 正文不做有损标签剥离", async () => {
        const source = Buffer.from(
            [
                "Message-ID: <html@example.com>",
                "From: Alice <alice@example.com>",
                "To: bot@example.com",
                "Content-Type: text/html; charset=utf-8",
                "",
                "<strong>Hello</strong>",
            ].join("\r\n"),
        );
        const email = await parseEmailSource(1, "INBOX", source);
        const event = projectEmailEvent(email, {
            accountId: id("account"),
            ownAddress: "bot@example.com",
            createId: id,
        });
        expect(event.message).toContainEqual({
            type: "email_html",
            data: { html: "<strong>Hello</strong>" },
        });
    });
});

function id(value: string | number) {
    const string = String(value);
    return { string, source: value, number: Number.isFinite(Number(value)) ? Number(value) : 1 };
}
