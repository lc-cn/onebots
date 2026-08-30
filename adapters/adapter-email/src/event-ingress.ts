import type { EventEmitter } from "node:events";
import { emitAllAwaited, ReliableEventIngress } from "onebots";
import { EmailError } from "./errors.js";
import type { EmailMessage } from "./types.js";

/** 外部邮件与 IMAP 同步共用的 canonical 事件入口。 */
export class EmailEventIngress {
    private readonly ingress = new ReliableEventIngress<string>();

    ingest(email: EmailMessage, dispatch: () => void | PromiseLike<void>): Promise<boolean> {
        if (!email.id || !email.from.address || !Number.isSafeInteger(email.uid)) {
            throw new EmailError("原始邮件缺少 id、uid 或发件人", {
                code: "EMAIL_INVALID_RAW_EVENT",
                details: email,
            });
        }
        const key = `${email.mailbox}:${email.uid}:${email.id}`;
        return this.ingress.deliver(key, dispatch);
    }
}

/** raw 与 canonical 视图相互独立；单个失败不能阻止另一个出口获得邮件。 */
export async function deliverEmailEvent(
    emitter: Pick<EventEmitter, "rawListeners">,
    email: EmailMessage,
): Promise<void> {
    const results = await Promise.allSettled([
        emitAllAwaited(emitter, "raw_email", email),
        emitAllAwaited(emitter, "email", email),
    ]);
    const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map(result => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "邮件事件存在多个投递失败");
}
