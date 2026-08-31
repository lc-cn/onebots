import { RecentEventDeduplicator } from "onebots";
import { EmailError } from "./errors.js";
import type { EmailMessage } from "./types.js";

/** 外部邮件与 IMAP 同步共用的 canonical 事件入口。 */
export class EmailEventIngress {
    private readonly receivedEmails = new RecentEventDeduplicator<string>();

    ingest(email: EmailMessage, dispatch: () => void): boolean {
        if (!email.id || !email.from.address || !Number.isSafeInteger(email.uid)) {
            throw new EmailError("原始邮件缺少 id、uid 或发件人", {
                code: "EMAIL_INVALID_RAW_EVENT",
                details: email,
            });
        }
        const key = `${email.mailbox}:${email.uid}:${email.id}`;
        if (this.receivedEmails.has(key)) return false;
        dispatch();
        this.receivedEmails.commit(key);
        return true;
    }
}
