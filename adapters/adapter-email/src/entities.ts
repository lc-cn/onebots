import type { Adapter, CommonEvent, CommonTypes } from "onebots";
import { EmailError } from "./errors.js";
import type { EmailMessage } from "./types.js";

/** 将原生邮件转换为通用消息查询结果。 */
export function toMessageInfo(
    email: EmailMessage,
    event: CommonEvent.Message<EmailMessage>,
    ownAddress: string,
    createId: (value: string | number) => CommonTypes.Id,
): Adapter.MessageInfo {
    const recipients = parseRecipients(
        [email.from, ...email.to, ...(email.cc || [])]
            .map(address => address.address)
            .filter(address => address.toLowerCase() !== ownAddress.toLowerCase())
            .join(","),
    );
    return {
        message_id: createId(email.id),
        time: Math.floor(email.date.getTime() / 1000),
        sender: {
            scene_type: event.message_type,
            sender_id: createId(email.from.address),
            scene_id: createId(recipients.join(",")),
            sender_name: email.from.name || email.from.address,
            scene_name: email.subject,
        },
        message: event.message,
    };
}

/** 解析由逗号分隔的邮件会话地址并去重。 */
export function parseRecipients(value: string): string[] {
    const recipients = [
        ...new Map(
            value
                .split(",")
                .map(item => item.trim())
                .filter(Boolean)
                .map(address => [address.toLowerCase(), address]),
        ).values(),
    ];
    if (!recipients.length || recipients.some(address => !isEmailAddress(address))) {
        throw new EmailError(`无效的邮件收件人: ${value}`, {
            code: "EMAIL_INVALID_RECIPIENT",
        });
    }
    return recipients;
}

function isEmailAddress(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
