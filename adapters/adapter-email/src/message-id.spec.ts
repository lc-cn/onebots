import { describe, expect, it } from "vitest";
import { createImapMessageId, parseImapMessageId } from "./message-id.js";

describe("IMAP 消息标识", () => {
    it("对任意 Unicode 目录保持可逆", () => {
        const id = createImapMessageId("归档/2026:八月", 42, 998n);
        expect(parseImapMessageId(id)).toEqual({
            mailbox: "归档/2026:八月",
            uid: 42,
            uidValidity: 998n,
        });
    });

    it("不误解析普通 RFC Message-ID，并拒绝损坏的原生标识", () => {
        expect(parseImapMessageId("<mail@example.com>")).toBeUndefined();
        expect(() => parseImapMessageId("onebots-imap:v1:not/base64:0")).toThrowError(
            expect.objectContaining({ code: "EMAIL_INVALID_IMAP_IDENTITY" }),
        );
    });
});
