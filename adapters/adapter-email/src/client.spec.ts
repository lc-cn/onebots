import { EventEmitter } from "node:events";
import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";
import { EmailClient } from "./client.js";
import { createImapMessageId } from "./message-id.js";
import type { EmailSmtpTransport } from "./transports.js";
import type { EmailConfig, EmailMessage } from "./types.js";

describe("EmailClient", () => {
    it("ingest 将外部邮件送入与 IMAP 相同的事件管线", () => {
        const client = new EmailClient(config);
        const raw = message();
        const rawListener = vi.fn();
        const emailListener = vi.fn();
        client.on("raw_email", rawListener);
        client.on("email", emailListener);

        client.ingest(raw);

        expect(rawListener).toHaveBeenCalledWith(raw);
        expect(emailListener).toHaveBeenCalledWith(raw);
    });

    it("ingest 拒绝缺少稳定身份的原始事件", () => {
        const client = new EmailClient(config);
        expect(() => client.ingest({ ...message(), id: "" })).toThrow("缺少 id、uid 或发件人");
    });

    it("要求密码或 OAuth2 token", () => {
        expect(() => new EmailClient({ ...config, auth: { user: "bot@example.com" } })).toThrow(
            "必须配置 auth.password",
        );
        expect(
            () =>
                new EmailClient({
                    ...config,
                    auth: { user: "bot@example.com", method: "oauth2" },
                }),
        ).toThrow("必须配置 auth.access_token");
    });

    it("在创建连接前拒绝非法地址、端口和代理", () => {
        expect(() => new EmailClient({ ...config, address: "invalid" })).toThrow(
            "address 不是有效邮箱地址",
        );
        expect(() => new EmailClient({ ...config, smtp: { ...config.smtp, port: 70000 } })).toThrow(
            "smtp.port 必须是 1 到 65535 之间的整数",
        );
        expect(() => new EmailClient({ ...config, proxy: { url: "not-a-url" } })).toThrow(
            "邮件代理地址不是有效 URL",
        );
        expect(
            () =>
                new EmailClient({
                    ...config,
                    imap: {
                        ...config.imap,
                        retry_initial_delay_ms: 2_000,
                        retry_max_delay_ms: 1_000,
                    },
                }),
        ).toThrow("不能大于 retry_max_delay_ms");
    });

    it("重连成功瞬间再次关闭也会继续恢复", async () => {
        const first = new FakeImap();
        const second = new FakeImap();
        const third = new FakeImap();
        const clients = [first, second, third];
        const client = new EmailClient(config, {
            createSmtp: () => smtp,
            createImap: () => clients.shift() as unknown as ImapFlow,
            sleep: async () => undefined,
        });
        let connections = 0;
        client.on("connected", () => {
            connections += 1;
            if (connections === 2) second.disconnect();
        });

        await client.start();
        first.disconnect();

        await vi.waitFor(() => expect(connections).toBe(3));
        expect(client.status.receive_connected).toBe(true);
        await client.stop();
    });

    it("逐封隔离毒邮件并继续投递同批正常邮件", async () => {
        const imap = new FakeImap([
            { uid: 1, source: mailSource({ from: "" }) },
            { uid: 2, source: mailSource({ id: "<valid@example.com>" }) },
        ]);
        const client = createClient(imap);
        const emails: EmailMessage[] = [];
        const errors: unknown[] = [];
        client.on("email", email => emails.push(email));
        client.on("client_error", error => errors.push(error));

        await client.start();

        expect(emails.map(email => email.id)).toEqual(["<valid@example.com>"]);
        expect(errors).toContainEqual(
            expect.objectContaining({
                code: "EMAIL_MESSAGE_REJECTED",
                details: { mailbox: "INBOX", uid: 1 },
            }),
        );
        expect(imap.flagCalls).toEqual([[1, 2]]);
        await client.stop();
    });

    it("已投影邮件的 Seen 写回失败后只重试确认，不重复投递", async () => {
        const imap = new FakeImap([{ uid: 7, source: mailSource({ id: "<retry@example.com>" }) }]);
        imap.flagFailures = 1;
        const client = createClient(imap);
        const emailListener = vi.fn();
        client.on("email", emailListener);

        await client.start();
        expect(emailListener).toHaveBeenCalledTimes(1);
        expect(imap.flagCalls).toEqual([[7]]);

        imap.emit("exists");
        await vi.waitFor(() => expect(imap.flagCalls).toHaveLength(2));

        expect(imap.flagCalls).toEqual([[7], [7]]);
        expect(emailListener).toHaveBeenCalledTimes(1);
        await client.stop();
    });

    it("findEmail 直接按可逆原生 ID 回到来源目录与 UID", async () => {
        const imap = new FakeImap([
            { uid: 9, source: mailSource({ id: "", from: "alice@example.com" }) },
        ]);
        const client = createClient(imap);
        let receivedId: string | undefined;
        client.on("email", email => {
            receivedId = email.id;
        });
        await client.start();
        if (!receivedId) throw new Error("测试邮件未完成解析");

        await expect(client.findEmail(receivedId)).resolves.toMatchObject({
            uid: 9,
            mailbox: "INBOX",
        });
        expect(imap.fetchOneCalls).toEqual([{ uid: 9, mailbox: "INBOX" }]);
        await client.stop();
    });

    it("拒绝让旧 UIDVALIDITY 的原生 ID 命中新一代邮件", async () => {
        const imap = new FakeImap([{ uid: 9, source: mailSource({ id: "" }) }]);
        const client = createClient(imap);
        await client.start();

        await expect(client.findEmail(createImapMessageId("INBOX", 9, 99n))).rejects.toMatchObject({
            code: "EMAIL_UIDVALIDITY_CHANGED",
        });
        await client.stop();
    });
});

const config: EmailConfig = {
    account_id: "mail",
    address: "bot@example.com",
    auth: { user: "bot@example.com", password: "secret" },
    smtp: { host: "smtp.example.com" },
    imap: { host: "imap.example.com" },
};

function message(): EmailMessage {
    return {
        uid: 1,
        mailbox: "INBOX",
        id: "<mail@example.com>",
        subject: "hello",
        from: { address: "alice@example.com" },
        to: [{ address: "bot@example.com" }],
        date: new Date(0),
        headers: new Map(),
    };
}

const smtp: EmailSmtpTransport = {
    verify: async () => true,
    sendMail: async () => ({ message_id: "id", accepted: [], rejected: [], response: "ok" }),
    close: () => undefined,
};

interface FakeSource {
    uid: number;
    source: Buffer;
}

function createClient(imap: FakeImap): EmailClient {
    return new EmailClient(config, {
        createSmtp: () => smtp,
        createImap: () => imap as unknown as ImapFlow,
        sleep: async () => undefined,
    });
}

function mailSource(options: { id?: string; from?: string } = {}): Buffer {
    const headers = [
        options.id === "" ? undefined : `Message-ID: ${options.id || "<mail@example.com>"}`,
        options.from === "" ? undefined : `From: ${options.from || "alice@example.com"}`,
        "To: bot@example.com",
        "Subject: test",
        "",
        "body",
    ];
    return Buffer.from(
        headers.filter((value): value is string => value !== undefined).join("\r\n"),
    );
}

class FakeImap extends EventEmitter {
    usable = true;
    mailbox = { uidValidity: 100n };
    flagFailures = 0;
    readonly flagCalls: number[][] = [];
    readonly fetchOneCalls: Array<{ uid: number; mailbox: string }> = [];
    private currentMailbox = "INBOX";

    constructor(private readonly sources: FakeSource[] = []) {
        super();
    }

    async connect() {}
    async mailboxOpen() {}
    async search() {
        return this.sources.map(item => item.uid);
    }
    async fetchAll(uids: number[]) {
        return this.sources.filter(item => uids.includes(item.uid));
    }
    async fetchOne(uid: string) {
        const item = this.sources.find(source => source.uid === Number(uid));
        this.fetchOneCalls.push({ uid: Number(uid), mailbox: this.currentMailbox });
        return item;
    }
    async messageFlagsAdd(uids: number[]) {
        this.flagCalls.push([...uids]);
        if (this.flagFailures > 0) {
            this.flagFailures -= 1;
            throw new Error("flag failed");
        }
    }
    async getMailboxLock(mailbox: string) {
        this.currentMailbox = mailbox;
        return { release: () => undefined };
    }
    async logout() {
        this.disconnect();
    }
    close() {
        this.disconnect();
    }
    disconnect() {
        if (!this.usable) return;
        this.usable = false;
        this.emit("close");
    }
}
