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

    it("复制邮件并支持任意 IMAP flags", async () => {
        const copyEmails = vi.fn().mockResolvedValue(undefined);
        const updateFlags = vi.fn().mockResolvedValue(undefined);
        const client = { copyEmails, updateFlags } as never;

        await executeEmailPlatformAction(client, "copy_email", {
            uids: [1, 2],
            destination: "Archive",
            mailbox: "INBOX",
        });
        await executeEmailPlatformAction(client, "add_email_flags", {
            uids: 1,
            flags: ["$Forwarded", "\\Answered"],
        });

        expect(copyEmails).toHaveBeenCalledWith([1, 2], "Archive", "INBOX");
        expect(updateFlags).toHaveBeenCalledWith(
            [1],
            ["$Forwarded", "\\Answered"],
            "add",
            undefined,
        );

        await executeEmailPlatformAction(client, "set_email_flags", {
            uids: [1, 2],
            flags: ["\\Seen"],
        });
        expect(updateFlags).toHaveBeenLastCalledWith([1, 2], ["\\Seen"], "set", undefined);
    });

    it("暴露结构化 STATUS、quota、NOOP 与原始邮件追加", async () => {
        const executeMailboxNative = vi.fn().mockResolvedValue({ ok: true });
        const client = { executeMailboxNative } as never;

        await executeEmailPlatformAction(client, "get_mailbox_status", {
            path: "INBOX",
            query: { messages: true, uidValidity: true },
        });
        expect(executeMailboxNative).toHaveBeenLastCalledWith({
            type: "status",
            path: "INBOX",
            query: { messages: true, uidValidity: true },
        });

        await executeEmailPlatformAction(client, "get_mailbox_quota", {});
        expect(executeMailboxNative).toHaveBeenLastCalledWith({ type: "quota", path: undefined });

        await executeEmailPlatformAction(client, "noop_imap", {});
        expect(executeMailboxNative).toHaveBeenLastCalledWith({ type: "noop" });

        const source = Buffer.from("Subject: test\r\n\r\nbody");
        await executeEmailPlatformAction(client, "append_raw_email", {
            mailbox: "Sent",
            data_base64: source.toString("base64"),
            flags: ["\\Seen"],
            internal_date: "2026-08-31T00:00:00Z",
        });
        expect(executeMailboxNative).toHaveBeenLastCalledWith({
            type: "append",
            path: "Sent",
            content: source,
            flags: ["\\Seen"],
            internalDate: "2026-08-31T00:00:00Z",
        });
    });

    it("拒绝显式无效的可选参数和附件 disposition", async () => {
        await expect(
            executeEmailPlatformAction({ searchEmails: vi.fn() } as never, "search_emails", {
                query: { all: true },
                mailbox: null,
            }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_ACTION_PARAM" });
        await expect(
            executeEmailPlatformAction({ sendEmail: vi.fn() } as never, "send_email", {
                to: "alice@example.com",
                subject: "test",
                attachments: [{ filename: "a.txt", content: "a", disposition: "unknown" }],
            }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_ACTION_PARAM" });
        await expect(
            executeEmailPlatformAction({ sendEmail: vi.fn() } as never, "send_email", {
                to: "alice@example.com",
                subject: "test",
                attachments: [{ filename: "a.txt" }],
            }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_ACTION_PARAM" });
        await expect(
            executeEmailPlatformAction({ sendEmail: vi.fn() } as never, "send_email", {
                to: "alice@example.com",
                subject: "test",
                headers: { Subject: "ok\r\nBcc: victim@example.com" },
            }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_SEGMENT" });
    });

    it("拒绝未知字段、歧义选择器与宽松嵌套对象", async () => {
        const client = { listMailboxes: vi.fn(), findEmail: vi.fn(), sendEmail: vi.fn() } as never;
        await expect(
            executeEmailPlatformAction(client, "list_mailboxes", { typo: true }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_ACTION_PARAM" });
        await expect(
            executeEmailPlatformAction(client, "get_email", {
                uid: 1,
                message_id: "<same@example.com>",
            }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_ACTION_PARAM" });
        await expect(
            executeEmailPlatformAction({ searchEmails: vi.fn() } as never, "search_emails", {
                query: { all: true, typo: true },
            }),
        ).rejects.toMatchObject({ code: "EMAIL_INVALID_ACTION_PARAM" });
        await expect(
            executeEmailPlatformAction(client, "send_email", {
                to: "alice@example.com",
                subject: "test",
                attachments: [{ filename: "a.txt", content: "a", typo: true }],
            }),
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
