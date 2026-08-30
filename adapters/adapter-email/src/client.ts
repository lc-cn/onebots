import { EventEmitter } from "node:events";
import { ImapFlow, type SearchObject } from "imapflow";
import { FailureCollector } from "onebots";
import type { EmailClientEvents, EmailClientOptions } from "./client-contract.js";
export type { EmailClientEvents, EmailClientOptions } from "./client-contract.js";
import { abortableSleep, emailNotFound, isAbortError, parseFetched } from "./client-utils.js";
import { EmailError } from "./errors.js";
import { deliverEmailEvent, EmailEventIngress } from "./event-ingress.js";
import { manageEmailMailbox, type EmailMailboxOperation } from "./mailbox-operations.js";
import {
    executeEmailMailboxNativeCommand,
    type EmailMailboxNativeCommand,
    type EmailMailboxNativeResult,
} from "./mailbox-native.js";
import { sendEmail } from "./send-email.js";
import { parseEmailSource } from "./events.js";
import { parseImapMessageId } from "./message-id.js";
import { EmailDeliveryState, syncUnseenMessages } from "./sync.js";
import {
    createImapClient,
    createSmtpTransport,
    requireEmailImapConfig,
    resolveEmailReceiveMode,
    type EmailSmtpTransport,
    validateEmailConfig,
} from "./transports.js";
import type {
    EmailConfig,
    EmailImapConfig,
    EmailMessage,
    EmailSendOptions,
    EmailSendResult,
} from "./types.js";

/** 可独立嵌入的 SMTP、IMAP IDLE 与邮件管理客户端。 */
export class EmailClient extends EventEmitter<EmailClientEvents> {
    private readonly createSmtp: () => EmailSmtpTransport;
    private readonly createImap: () => ImapFlow;
    private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
    private smtp?: EmailSmtpTransport;
    private imap?: ImapFlow;
    private lifecycleAbort?: AbortController;
    private lifecycleGeneration = 0;
    private startRequest?: Promise<void>;
    private reconnectRequest?: Promise<void>;
    private syncRequest?: Promise<void>;
    private syncAgain = false;
    private pollTimer?: NodeJS.Timeout;
    private readonly deliveries = new EmailDeliveryState();
    private readonly eventIngress = new EmailEventIngress();
    private started = false;
    private receiveConnected = false;

    constructor(
        readonly config: EmailConfig,
        options: EmailClientOptions = {},
    ) {
        super();
        validateEmailConfig(config);
        this.createSmtp = options.createSmtp || (() => createSmtpTransport(config));
        this.createImap = options.createImap || (() => createImapClient(config));
        this.sleep = options.sleep || abortableSleep;
    }

    /** 分别报告客户端启动状态、接收连接与显式接收模式。 */
    get status(): {
        started: boolean;
        receive_connected: boolean;
        receive_mode: "imap" | "manual";
    } {
        return {
            started: this.started,
            receive_connected: this.receiveConnected,
            receive_mode: resolveEmailReceiveMode(this.config),
        };
    }

    /** 始终验证 SMTP；imap 模式启动并无限恢复接收连接，manual 模式不创建 IMAP。 */
    async start(): Promise<void> {
        if (this.startRequest) return this.startRequest;
        if (this.started) return;
        const request = this.initialize();
        this.startRequest = request;
        try {
            await request;
        } finally {
            if (this.startRequest === request) this.startRequest = undefined;
        }
    }

    private async initialize(): Promise<void> {
        const generation = ++this.lifecycleGeneration;
        const controller = new AbortController();
        this.lifecycleAbort = controller;
        this.started = true;
        try {
            this.smtp = this.createSmtp();
            await this.smtp.verify();
            if (resolveEmailReceiveMode(this.config) === "imap") {
                try {
                    await this.connectImap(generation, controller.signal);
                } catch (error) {
                    const wrapped = EmailError.wrap(error, "EMAIL_IMAP_CONNECT_FAILED", "connect");
                    this.safeEmit("disconnected", wrapped);
                    this.reportError(wrapped);
                    this.scheduleReconnect(generation, controller.signal, 1);
                }
            }
            if (!this.isCurrent(generation, controller.signal)) return;
            this.safeEmit("ready");
        } catch (error) {
            controller.abort();
            this.started = false;
            this.lifecycleAbort = undefined;
            this.smtp?.close();
            this.smtp = undefined;
            throw EmailError.wrap(error, "EMAIL_START_FAILED", "start");
        }
    }

    /** 停止轮询、重连、IMAP 和 SMTP；重复调用安全。 */
    async stop(): Promise<void> {
        if (!this.started && !this.startRequest) return;
        const failures = new FailureCollector();
        this.started = false;
        this.lifecycleGeneration += 1;
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        this.clearPollTimer();
        const imap = this.imap;
        this.imap = undefined;
        this.receiveConnected = false;
        if (imap?.usable) {
            try {
                await imap.logout();
            } catch (error) {
                const wrapped = EmailError.wrap(error, "EMAIL_IMAP_LOGOUT_FAILED", "logout");
                failures.add(wrapped);
                this.reportError(wrapped);
                imap.close();
            }
        } else {
            imap?.close();
        }
        await failures.capture(
            () => {
                try {
                    this.smtp?.close();
                } catch (error) {
                    throw EmailError.wrap(error, "EMAIL_SMTP_STOP_FAILED", "stop");
                }
            },
            error => this.reportError(EmailError.wrap(error, "EMAIL_SMTP_STOP_FAILED", "stop")),
        );
        this.smtp = undefined;
        await this.startRequest?.catch(error => {
            if (!isAbortError(error)) {
                const wrapped = EmailError.wrap(error, "EMAIL_START_STOP_FAILED", "stop");
                failures.add(wrapped);
                this.reportError(wrapped);
            }
        });
        await this.reconnectRequest?.catch(error => {
            if (!isAbortError(error)) {
                const wrapped = EmailError.wrap(error, "EMAIL_RECONNECT_STOP_FAILED", "stop");
                failures.add(wrapped);
                this.reportError(wrapped);
            }
        });
        this.reconnectRequest = undefined;
        this.safeEmit("stop");
        failures.throwIfAny("邮件客户端停止失败");
    }

    /** 发送完整邮件并返回 SMTP 接收与拒绝结果。 */
    async sendEmail(options: EmailSendOptions): Promise<EmailSendResult> {
        if (!this.smtp) {
            throw new EmailError("邮件客户端尚未启动", { code: "EMAIL_NOT_STARTED" });
        }
        return sendEmail(this.smtp, this.config, options);
    }

    /** 将外部取得的邮件交给与 IMAP 相同的事件管线。 */
    ingest(email: EmailMessage): Promise<boolean> {
        return this.eventIngress.ingest(email, () => deliverEmailEvent(this, email));
    }

    /** 获取邮箱目录列表。 */
    async listMailboxes() {
        return this.requireImap().list({ statusQuery: { messages: true, unseen: true } });
    }

    /** 按 UID 获取一封邮件。 */
    async getEmail(
        uid: number,
        mailbox = this.mailbox,
        expectedUidValidity?: bigint,
    ): Promise<EmailMessage> {
        return this.withMailbox(mailbox, async imap => {
            const uidValidity = imap.mailbox ? imap.mailbox.uidValidity : undefined;
            if (expectedUidValidity !== undefined && uidValidity !== expectedUidValidity) {
                throw new EmailError(`邮箱目录 ${mailbox} 的 UIDVALIDITY 已变化`, {
                    code: "EMAIL_UIDVALIDITY_CHANGED",
                    details: { mailbox, expected: expectedUidValidity, actual: uidValidity },
                });
            }
            const message = await imap.fetchOne(String(uid), { source: true }, { uid: true });
            if (!message || !message.source) throw emailNotFound(uid, mailbox);
            return parseEmailSource(message.uid, mailbox, message.source, uidValidity);
        });
    }

    /** 搜索并获取邮件，默认从新到旧返回。 */
    async searchEmails(
        query: SearchObject,
        options: { mailbox?: string; limit?: number } = {},
    ): Promise<EmailMessage[]> {
        const mailbox = options.mailbox || this.mailbox;
        const limit = Math.min(Math.max(options.limit || 50, 1), 500);
        return this.withMailbox(mailbox, async imap => {
            const found = await imap.search(query, { uid: true });
            const uids = found ? found.slice(-limit).reverse() : [];
            if (!uids.length) return [];
            const messages = await imap.fetchAll(uids, { source: true }, { uid: true });
            const uidValidity = imap.mailbox ? imap.mailbox.uidValidity : undefined;
            return parseFetched(messages, mailbox, uidValidity);
        });
    }

    /** 增加或移除邮件系统标记。 */
    async updateFlags(
        uids: readonly number[],
        flags: readonly string[],
        operation: "add" | "remove" | "set",
        mailbox = this.mailbox,
    ): Promise<void> {
        await this.withMailbox(mailbox, async imap => {
            const method =
                operation === "add"
                    ? imap.messageFlagsAdd.bind(imap)
                    : operation === "remove"
                      ? imap.messageFlagsRemove.bind(imap)
                      : imap.messageFlagsSet.bind(imap);
            await method([...uids], [...flags], { uid: true });
        });
    }

    /** 移动邮件到另一个目录。 */
    async moveEmails(
        uids: readonly number[],
        destination: string,
        mailbox = this.mailbox,
    ): Promise<void> {
        await this.withMailbox(mailbox, async imap => {
            await imap.messageMove([...uids], destination, { uid: true });
        });
    }

    /** 复制邮件到另一个目录。 */
    async copyEmails(
        uids: readonly number[],
        destination: string,
        mailbox = this.mailbox,
    ): Promise<void> {
        await this.withMailbox(mailbox, async imap => {
            await imap.messageCopy([...uids], destination, { uid: true });
        });
    }

    /** 删除邮件。 */
    async deleteEmails(uids: readonly number[], mailbox = this.mailbox): Promise<void> {
        await this.withMailbox(mailbox, async imap => {
            await imap.messageDelete([...uids], { uid: true });
        });
    }

    /** 按 RFC Message-ID 或可逆 IMAP 原生 ID 定位邮件。 */
    async findEmail(messageId: string, mailbox = this.mailbox): Promise<EmailMessage> {
        const location = parseImapMessageId(messageId);
        if (location) return this.getEmail(location.uid, location.mailbox, location.uidValidity);
        const [email] = await this.searchEmails(
            { header: { "message-id": messageId } },
            { mailbox, limit: 1 },
        );
        if (!email) {
            throw new EmailError(`邮箱目录 ${mailbox} 中不存在 Message-ID ${messageId}`, {
                code: "EMAIL_NOT_FOUND",
            });
        }
        return email;
    }

    /** 创建、重命名、删除或订阅邮箱目录。 */
    async manageMailbox(
        operation: EmailMailboxOperation,
        path: string,
        newPath?: string,
    ): Promise<unknown> {
        return manageEmailMailbox(this.requireImap(), operation, path, newPath);
    }

    /** 执行已建模的稳定 IMAP 原生命令。 */
    executeMailboxNative(command: EmailMailboxNativeCommand): Promise<EmailMailboxNativeResult> {
        return executeEmailMailboxNativeCommand(this.requireImap(), command);
    }

    private get mailbox(): string {
        return this.imapConfig.mailbox || "INBOX";
    }

    private get imapConfig(): EmailImapConfig {
        return requireEmailImapConfig(this.config);
    }

    private async connectImap(generation: number, signal: AbortSignal): Promise<void> {
        const imap = this.createImap();
        this.imap = imap;
        imap.on("error", error =>
            this.reportError(EmailError.wrap(error, "EMAIL_IMAP_ERROR", "imap")),
        );
        imap.once("close", () => this.handleClose(imap, generation, signal));
        imap.on("exists", () => this.queueSync());
        try {
            await imap.connect();
            if (!this.isCurrent(generation, signal)) {
                if (this.imap === imap) this.imap = undefined;
                await imap.logout().catch(() => imap.close());
                return;
            }
            await imap.mailboxOpen(this.mailbox);
            this.receiveConnected = true;
            this.startPollTimer();
            this.safeEmit("connected");
            await this.queueSync();
        } catch (error) {
            if (this.imap === imap) this.imap = undefined;
            imap.close();
            throw error;
        }
    }

    private handleClose(imap: ImapFlow, generation: number, signal: AbortSignal): void {
        if (this.imap !== imap) return;
        this.imap = undefined;
        this.receiveConnected = false;
        this.clearPollTimer();
        if (!this.isCurrent(generation, signal)) return;
        const error = new EmailError("IMAP 连接已关闭", { code: "EMAIL_IMAP_CLOSED" });
        this.safeEmit("disconnected", error);
        this.scheduleReconnect(generation, signal, 1);
    }

    private scheduleReconnect(
        generation: number,
        signal: AbortSignal,
        initialFailure: number,
    ): void {
        if (this.reconnectRequest || !this.isCurrent(generation, signal)) return;
        const request = this.reconnectLoop(generation, signal, initialFailure).catch(error => {
            if (!isAbortError(error)) {
                this.reportError(EmailError.wrap(error, "EMAIL_RECONNECT_FAILED", "connect"));
            }
        });
        this.reconnectRequest = request;
        void request.finally(() => {
            if (this.reconnectRequest === request) this.reconnectRequest = undefined;
            if (this.isCurrent(generation, signal) && !this.receiveConnected) {
                this.scheduleReconnect(generation, signal, initialFailure + 1);
            }
        });
    }

    private async reconnectLoop(
        generation: number,
        signal: AbortSignal,
        initialFailure: number,
    ): Promise<void> {
        let failures = initialFailure;
        while (this.isCurrent(generation, signal) && !this.receiveConnected) {
            await this.sleep(this.retryDelay(failures), signal);
            if (!this.isCurrent(generation, signal)) return;
            try {
                await this.connectImap(generation, signal);
                return;
            } catch (error) {
                const wrapped = EmailError.wrap(error, "EMAIL_IMAP_RECONNECT_FAILED", "connect");
                this.safeEmit("disconnected", wrapped);
                this.reportError(wrapped);
                failures += 1;
            }
        }
    }

    private queueSync(): Promise<void> {
        if (this.syncRequest) {
            this.syncAgain = true;
            return this.syncRequest;
        }
        const request = this.drainSyncQueue().catch(error => {
            this.reportError(EmailError.wrap(error, "EMAIL_SYNC_FAILED", "sync"));
        });
        this.syncRequest = request;
        void request.finally(() => {
            if (this.syncRequest === request) this.syncRequest = undefined;
        });
        return request;
    }

    private async drainSyncQueue(): Promise<void> {
        do {
            this.syncAgain = false;
            await this.syncUnseen();
        } while (this.syncAgain && this.receiveConnected);
    }

    private async syncUnseen(): Promise<void> {
        await this.withMailbox(this.mailbox, async imap => {
            await syncUnseenMessages({
                imap,
                mailbox: this.mailbox,
                markSeen: this.imapConfig.mark_seen !== false,
                deliveries: this.deliveries,
                ingest: email => this.ingest(email).then(() => undefined),
                reportError: error => this.reportError(error),
            });
        });
    }

    private async withMailbox<T>(
        mailbox: string,
        action: (imap: ImapFlow) => Promise<T>,
    ): Promise<T> {
        const imap = this.requireImap();
        const lock = await imap.getMailboxLock(mailbox);
        try {
            return await action(imap);
        } finally {
            lock.release();
            if (mailbox !== this.mailbox && imap.usable) {
                try {
                    const restore = await imap.getMailboxLock(this.mailbox);
                    restore.release();
                } catch (error) {
                    this.reportError(
                        EmailError.wrap(error, "EMAIL_MAILBOX_RESTORE_FAILED", "mailbox_open"),
                    );
                }
            }
        }
    }

    private requireImap(): ImapFlow {
        requireEmailImapConfig(this.config);
        if (!this.imap?.usable || !this.receiveConnected) {
            throw new EmailError("IMAP 当前未连接", { code: "EMAIL_IMAP_OFFLINE" });
        }
        return this.imap;
    }

    private isCurrent(generation: number, signal: AbortSignal): boolean {
        return this.started && generation === this.lifecycleGeneration && !signal.aborted;
    }

    private retryDelay(failures: number): number {
        const initial = this.imapConfig.retry_initial_delay_ms ?? 1_000;
        const maximum = this.imapConfig.retry_max_delay_ms ?? 30_000;
        return Math.min(maximum, initial * 2 ** Math.min(Math.max(failures - 1, 0), 10));
    }

    private startPollTimer(): void {
        this.clearPollTimer();
        const interval = this.imapConfig.poll_interval_ms ?? 60_000;
        if (interval <= 0) return;
        this.pollTimer = setInterval(() => void this.queueSync(), interval);
    }

    private clearPollTimer(): void {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = undefined;
    }

    private reportError(error: EmailError): void {
        this.safeEmit("client_error", error);
    }

    private safeEmit<K extends keyof EmailClientEvents>(
        name: K,
        ...args: EmailClientEvents[K]
    ): void {
        for (const listener of this.rawListeners(String(name))) {
            try {
                Reflect.apply(listener, this, args);
            } catch (error) {
                if (name !== "client_error") {
                    this.safeEmit("client_error", EmailError.wrap(error, "EMAIL_LISTENER_FAILED"));
                }
            }
        }
    }
}
