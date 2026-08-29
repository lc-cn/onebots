import { EventEmitter } from "node:events";
import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";
import { EmailClient } from "./client.js";
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
            "必须配置 password 或 access_token",
        );
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

class FakeImap extends EventEmitter {
    usable = true;

    async connect() {}
    async mailboxOpen() {}
    async search() {
        return [];
    }
    async fetchAll() {
        return [];
    }
    async getMailboxLock() {
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
