import { CommonEvent, type CommonTypes } from "onebots";
import { simpleParser, type ParsedMail } from "mailparser";
import { EmailError } from "./errors.js";
import type { EmailAddress, EmailMessage } from "./types.js";

export interface EmailProjectionContext {
    accountId: CommonTypes.Id;
    ownAddress: string;
    createId(value: string | number): CommonTypes.Id;
}

/** 解析完整 RFC 822 源码并保留线程、地址、附件与头信息。 */
export async function parseEmailSource(
    uid: number,
    mailbox: string,
    source: Buffer,
): Promise<EmailMessage> {
    const parsed = await simpleParser(source);
    const from = addresses(parsed.from)[0];
    if (!from?.address) {
        throw new EmailError(`IMAP 邮件 UID ${uid} 缺少发件人地址`, {
            code: "EMAIL_SENDER_MISSING",
            operation: "parse_email",
        });
    }
    return {
        uid,
        mailbox,
        id: parsed.messageId || `${mailbox}:${uid}`,
        subject: parsed.subject || "",
        from,
        to: addresses(parsed.to),
        cc: optionalAddresses(parsed.cc),
        bcc: optionalAddresses(parsed.bcc),
        reply_to: optionalAddresses(parsed.replyTo),
        html: typeof parsed.html === "string" ? parsed.html : undefined,
        text: parsed.text || undefined,
        attachments: parsed.attachments.map(attachment => ({
            filename: attachment.filename || "attachment",
            content_type: attachment.contentType || "application/octet-stream",
            content: attachment.content,
            size: attachment.size,
            checksum: attachment.checksum,
            content_id: attachment.contentId || attachment.cid || undefined,
            disposition: attachment.contentDisposition,
            related: attachment.related,
        })),
        date: parsed.date || new Date(),
        in_reply_to: parsed.inReplyTo || undefined,
        references: normalizeReferences(parsed.references),
        headers: parsed.headers,
    };
}

/** 将邮件投影为可直接回复或 reply-all 的通用消息事件。 */
export function projectEmailEvent(
    email: EmailMessage,
    context: EmailProjectionContext,
): CommonEvent.Message<EmailMessage> {
    const recipients = replyRecipients(email, context.ownAddress);
    const sceneId = recipients.join(",");
    const segments: CommonTypes.Segment[] = [];
    if (email.text) segments.push({ type: "text", data: { text: email.text } });
    if (email.html) segments.push({ type: "email_html", data: { html: email.html } });
    for (const attachment of email.attachments || []) {
        segments.push({
            type: attachment.content_type.startsWith("image/") ? "image" : "file",
            data: {
                name: attachment.filename,
                file: attachment.content,
                url: `data:${attachment.content_type};base64,${attachment.content.toString("base64")}`,
                content_type: attachment.content_type,
                size: attachment.size,
                cid: attachment.content_id,
                disposition: attachment.disposition,
            },
        });
    }
    return {
        id: context.createId(`event:${email.mailbox}:${email.uid}`),
        timestamp: email.date.getTime(),
        platform: "email",
        bot_id: context.accountId,
        type: "message",
        message_type: recipients.length > 1 ? "direct" : "private",
        sender: {
            id: context.createId(email.from.address),
            name: email.from.name || email.from.address,
            email: email.from.address,
        },
        message_id: context.createId(email.id),
        raw_message: email.text || email.html || "",
        message: segments,
        raw_event: email,
        extensions: {
            email: {
                uid: email.uid,
                mailbox: email.mailbox,
                subject: email.subject,
                scene_id: sceneId,
                to: email.to,
                cc: email.cc,
                bcc: email.bcc,
                reply_to: email.reply_to,
                in_reply_to: email.in_reply_to,
                references: email.references,
                headers: Object.fromEntries(email.headers),
            },
        },
    };
}

function replyRecipients(email: EmailMessage, ownAddress: string): string[] {
    const own = ownAddress.toLowerCase();
    const candidates = [email.from, ...email.to, ...(email.cc || [])];
    return [
        ...new Map(
            candidates
                .map(address => address.address.trim())
                .filter(address => address && address.toLowerCase() !== own)
                .map(address => [address.toLowerCase(), address]),
        ).values(),
    ];
}

function addresses(value: ParsedMail["to"] | ParsedMail["from"]): EmailAddress[] {
    const values = (Array.isArray(value) ? value : value ? [value] : []).flatMap(
        item => item.value,
    );
    return values.flatMap(item =>
        typeof item.address === "string" && item.address
            ? [{ address: item.address, name: item.name || undefined }]
            : [],
    );
}

function optionalAddresses(value: ParsedMail["to"]): EmailAddress[] | undefined {
    const result = addresses(value);
    return result.length ? result : undefined;
}

function normalizeReferences(value: string | string[] | undefined): string[] | undefined {
    if (!value) return undefined;
    return Array.isArray(value) ? value : [value];
}
