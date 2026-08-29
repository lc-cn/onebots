import { ErrorCategory, OneBotsError } from "onebots";
import { describe, expect, it } from "vitest";
import { EmailError } from "./errors.js";

describe("邮件结构化错误", () => {
    it("继承核心错误并保留操作上下文", () => {
        const error = new EmailError("IMAP 连接失败", {
            code: "EMAIL_IMAP_CONNECT_FAILED",
            operation: "connect",
            details: { mailbox: "INBOX" },
        });
        expect(error).toBeInstanceOf(OneBotsError);
        expect(error.category).toBe(ErrorCategory.NETWORK);
        expect(error.context).toMatchObject({
            operation: "connect",
            details: { mailbox: "INBOX" },
        });
    });
});
