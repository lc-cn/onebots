import { randomBytes } from "node:crypto";
import type { CommonTypes } from "onebots";
import { EmailError } from "./errors.js";
import { parseImapMessageId } from "./message-id.js";
import type { EmailOutgoingAttachment, EmailSendOptions } from "./types.js";

export interface CompiledEmail {
    text?: string;
    html?: string;
    subject?: string;
    cc?: string[];
    bcc?: string[];
    reply_to?: string[];
    in_reply_to?: string;
    references?: string[];
    priority?: "high" | "normal" | "low";
    headers?: Record<string, string>;
    attachments?: EmailOutgoingAttachment[];
}

/** 将通用消息段编译为 RFC 邮件正文、线程头和附件。 */
export function compileEmailMessage(segments: readonly CommonTypes.Segment[]): CompiledEmail {
    const text: string[] = [];
    const html: string[] = [];
    const attachments: EmailOutgoingAttachment[] = [];
    const metadata: CompiledEmail = {};
    let replyCount = 0;

    for (const segment of segments) {
        if (segment.type === "text") {
            const value = stringValue(segment.data.text);
            text.push(value);
            html.push(escapeHtml(value).replace(/\n/g, "<br>"));
            continue;
        }
        if (segment.type === "reply") {
            replyCount += 1;
            if (replyCount > 1) {
                throw new EmailError("邮件只能包含一个 reply 段", {
                    code: "EMAIL_INVALID_SEGMENT",
                });
            }
            metadata.in_reply_to = threadMessageId(
                segment.data.message_id ?? segment.data.id,
                "reply.message_id",
            );
            continue;
        }
        if (segment.type === "image" || segment.type === "file") {
            const attachment = compileAttachment(segment, attachments.length);
            attachments.push(attachment);
            if (segment.type === "image" && attachment.cid) {
                html.push(
                    `<img src="cid:${escapeHtml(attachment.cid)}" alt="${escapeHtml(attachment.filename)}">`,
                );
            }
            continue;
        }
        if (segment.type === "email") {
            applyEmailMetadata(metadata, segment.data);
            continue;
        }
        throw new EmailError(`邮件不支持消息段 ${segment.type}`, {
            code: "EMAIL_UNSUPPORTED_SEGMENT",
            details: segment,
        });
    }

    if (metadata.in_reply_to) {
        metadata.references = [...(metadata.references || []), metadata.in_reply_to].filter(
            (value, index, values) => values.indexOf(value) === index,
        );
    }

    return {
        ...metadata,
        text: text.join("") || undefined,
        html: metadata.html || html.join("") || undefined,
        attachments: attachments.length ? attachments : undefined,
    };
}

/** 将编译结果与收件人、默认主题合并为完整发送参数。 */
export function createEmailSendOptions(
    to: readonly string[],
    subject: string,
    compiled: CompiledEmail,
): EmailSendOptions {
    return {
        to,
        subject: compiled.subject || subject,
        text: compiled.text,
        html: compiled.html,
        attachments: compiled.attachments,
        cc: compiled.cc,
        bcc: compiled.bcc,
        reply_to: compiled.reply_to,
        in_reply_to: compiled.in_reply_to,
        references: compiled.references,
        priority: compiled.priority,
        headers: compiled.headers,
    };
}

function compileAttachment(segment: CommonTypes.Segment, index: number): EmailOutgoingAttachment {
    const filename =
        stringValue(segment.data.name) ||
        stringValue(segment.data.filename) ||
        `${segment.type}-${index + 1}`;
    const contentType = stringValue(segment.data.content_type) || undefined;
    const source = segment.data.url ?? segment.data.file;
    if (Buffer.isBuffer(source)) {
        return withInline({ filename, content: source, content_type: contentType }, segment, index);
    }
    if (typeof source !== "string" || !source) {
        throw new EmailError(`邮件附件 ${filename} 缺少 url、file 或 Buffer`, {
            code: "EMAIL_ATTACHMENT_SOURCE_REQUIRED",
            details: segment,
        });
    }
    const attachment: EmailOutgoingAttachment = /^https?:\/\//i.test(source)
        ? { filename, href: source, content_type: contentType }
        : { filename, path: source, content_type: contentType };
    return withInline(attachment, segment, index);
}

function withInline(
    attachment: EmailOutgoingAttachment,
    segment: CommonTypes.Segment,
    index: number,
): EmailOutgoingAttachment {
    if (segment.type !== "image") return attachment;
    const cid =
        stringValue(segment.data.cid) || `onebots-${index}-${randomBytes(8).toString("hex")}@email`;
    return { ...attachment, cid, disposition: "inline" };
}

function applyEmailMetadata(target: CompiledEmail, data: Record<string, unknown>): void {
    if (data.subject !== undefined) target.subject = requiredString(data.subject, "email.subject");
    if (data.html !== undefined) target.html = requiredString(data.html, "email.html");
    if (data.cc !== undefined) target.cc = addressList(data.cc, "email.cc");
    if (data.bcc !== undefined) target.bcc = addressList(data.bcc, "email.bcc");
    if (data.reply_to !== undefined) target.reply_to = addressList(data.reply_to, "email.reply_to");
    if (data.in_reply_to !== undefined)
        target.in_reply_to = threadMessageId(data.in_reply_to, "email.in_reply_to");
    if (data.references !== undefined)
        target.references = addressList(data.references, "email.references");
    if (data.priority === "high" || data.priority === "normal" || data.priority === "low") {
        target.priority = data.priority;
    } else if (data.priority !== undefined) {
        throw invalidField("email.priority");
    }
    if (data.headers !== undefined)
        target.headers = validateEmailHeaders(data.headers, "email.headers");
}

function addressList(value: unknown, field: string): string[] {
    const values = Array.isArray(value) ? value : [value];
    return values.map(item => requiredString(item, field));
}

/** 校验 RFC 兼容 Header 名称，并拒绝值中的换行注入。 */
export function validateEmailHeaders(value: unknown, field: string): Record<string, string> {
    if (!isRecord(value)) throw invalidField(field);
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(key)) throw invalidField(`${field}.${key}`);
        const header = requiredString(item, `${field}.${key}`);
        if (/\r|\n/u.test(header)) throw invalidField(`${field}.${key}`);
        result[key] = header;
    }
    return result;
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw invalidField(field);
    return value.trim();
}

function threadMessageId(value: unknown, field: string): string {
    const messageId = requiredString(value, field);
    if (parseImapMessageId(messageId)) {
        throw new EmailError("来源邮件没有 RFC Message-ID，无法生成线程回复头", {
            code: "EMAIL_THREAD_ID_UNAVAILABLE",
            details: messageId,
        });
    }
    return messageId;
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function invalidField(field: string): EmailError {
    return new EmailError(`${field} 必须是有效字符串`, { code: "EMAIL_INVALID_SEGMENT" });
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => {
        const entities: Record<string, string> = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        };
        return entities[character] || character;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
