import type { ImapFlow } from "imapflow";
import { EmailError } from "./errors.js";
import { parseEmailSource } from "./events.js";
import type { EmailMessage } from "./types.js";

/** 记录已完成业务投递的邮件；与 IMAP Seen 确认状态刻意分离。 */
export class EmailDeliveryState {
    private readonly keys = new Set<string>();

    has(mailbox: string, uidValidity: bigint | undefined, uid: number): boolean {
        return this.keys.has(this.key(mailbox, uidValidity, uid));
    }

    remember(mailbox: string, uidValidity: bigint | undefined, uid: number): void {
        this.keys.add(this.key(mailbox, uidValidity, uid));
        if (this.keys.size <= 10_000) return;
        const oldest = this.keys.values().next().value;
        if (oldest) this.keys.delete(oldest);
    }

    private key(mailbox: string, uidValidity: bigint | undefined, uid: number): string {
        return `${mailbox}:${uidValidity?.toString() ?? "unknown"}:${uid}`;
    }
}

export interface SyncUnseenOptions {
    imap: ImapFlow;
    mailbox: string;
    markSeen: boolean;
    deliveries: EmailDeliveryState;
    ingest(email: EmailMessage): void;
    reportError(error: EmailError): void;
}

/** 逐封处理未读邮件，毒邮件与 Seen 写回失败都不会破坏投递进度。 */
export async function syncUnseenMessages(options: SyncUnseenOptions): Promise<void> {
    const found = await options.imap.search({ seen: false }, { uid: true });
    const uids = found || [];
    if (!uids.length) return;
    const fetched = await options.imap.fetchAll(uids, { source: true }, { uid: true });
    const uidValidity = options.imap.mailbox ? options.imap.mailbox.uidValidity : undefined;
    const markSeen: number[] = [];
    for (const item of fetched) {
        if (!item.source) continue;
        if (!options.deliveries.has(options.mailbox, uidValidity, item.uid)) {
            try {
                options.ingest(
                    await parseEmailSource(item.uid, options.mailbox, item.source, uidValidity),
                );
            } catch (error) {
                options.reportError(
                    new EmailError(`隔离无法解析的邮件 ${options.mailbox} UID ${item.uid}`, {
                        code: "EMAIL_MESSAGE_REJECTED",
                        operation: "sync",
                        details: { mailbox: options.mailbox, uid: item.uid },
                        cause: error,
                    }),
                );
            }
            options.deliveries.remember(options.mailbox, uidValidity, item.uid);
        }
        if (options.markSeen) markSeen.push(item.uid);
    }
    if (markSeen.length) {
        await options.imap.messageFlagsAdd(markSeen, ["\\Seen"], { uid: true });
    }
}
