import type { ImapFlow } from "imapflow";
import { EmailError } from "./errors.js";

export type EmailMailboxOperation = "create" | "rename" | "delete" | "subscribe" | "unsubscribe";

/** 执行邮箱目录管理，并在进入 IMAP SDK 前闭合操作参数。 */
export function manageEmailMailbox(
    imap: ImapFlow,
    operation: EmailMailboxOperation,
    path: string,
    newPath?: string,
): Promise<unknown> {
    if (operation === "create") return imap.mailboxCreate(path);
    if (operation === "rename") {
        if (!newPath) {
            throw new EmailError("重命名邮箱目录需要 new_path", {
                code: "EMAIL_INVALID_PARAM",
            });
        }
        return imap.mailboxRename(path, newPath);
    }
    if (operation === "delete") return imap.mailboxDelete(path);
    if (operation === "subscribe") return imap.mailboxSubscribe(path);
    return imap.mailboxUnsubscribe(path);
}
