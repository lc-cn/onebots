import { describe, expect, it, vi } from "vitest";
import { EmailClient } from "./client.js";
import { EMAIL_PLATFORM_ACTIONS, executeEmailPlatformAction } from "./platform-actions.js";
import type { EmailConfig } from "./types.js";

describe("email platform actions", () => {
    it("动作集合与执行白名单共用同一来源", async () => {
        const client = new EmailClient(config);
        const list = vi.spyOn(client, "listMailboxes").mockResolvedValue([]);
        await expect(executeEmailPlatformAction(client, "list_mailboxes", {})).resolves.toEqual([]);
        expect(EMAIL_PLATFORM_ACTIONS.has("list_mailboxes")).toBe(true);
        expect(list).toHaveBeenCalledOnce();
    });

    it("校验并递归编译 IMAP 搜索条件", async () => {
        const client = new EmailClient(config);
        const search = vi.spyOn(client, "searchEmails").mockResolvedValue([]);
        await executeEmailPlatformAction(client, "search_emails", {
            query: {
                or: [{ from: "alice@example.com" }, { subject: "release" }],
                seen: false,
                header: { "x-project": "onebots" },
            },
            limit: 20,
        });
        expect(search).toHaveBeenCalledWith(
            {
                or: [{ from: "alice@example.com" }, { subject: "release" }],
                seen: false,
                header: { "x-project": "onebots" },
            },
            { mailbox: undefined, limit: 20 },
        );
    });

    it("拒绝未声明动作与非法搜索条件", async () => {
        const client = new EmailClient(config);
        await expect(executeEmailPlatformAction(client, "raw_imap", {})).rejects.toMatchObject({
            code: "EMAIL_ACTION_NOT_IMPLEMENTED",
        });
        await expect(
            executeEmailPlatformAction(client, "search_emails", { query: { seen: "yes" } }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_ACTION_PARAM" });
    });
});

const config: EmailConfig = {
    account_id: "mail",
    address: "bot@example.com",
    auth: { user: "bot@example.com", password: "secret" },
    smtp: { host: "smtp.example.com" },
    imap: { host: "imap.example.com" },
};
