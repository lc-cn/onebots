import { mutableAddress } from "./client-utils.js";
import type { EmailSmtpTransport } from "./transports.js";
import type { EmailConfig, EmailSendOptions, EmailSendResult } from "./types.js";

/** 将闭合后的邮件参数映射为 Nodemailer 发送模型。 */
export function sendEmail(
    smtp: EmailSmtpTransport,
    config: EmailConfig,
    options: EmailSendOptions,
): Promise<EmailSendResult> {
    return smtp.sendMail({
        from: { address: config.address, name: config.display_name || "" },
        to: mutableAddress(options.to),
        cc: mutableAddress(options.cc),
        bcc: mutableAddress(options.bcc),
        replyTo: mutableAddress(options.reply_to),
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments?.map(attachment => ({
            filename: attachment.filename,
            content: attachment.content,
            path: attachment.path,
            href: attachment.href,
            contentType: attachment.content_type,
            cid: attachment.cid,
            contentDisposition: attachment.disposition,
        })),
        inReplyTo: options.in_reply_to,
        references: options.references ? [...options.references] : undefined,
        priority: options.priority,
        headers: options.headers,
    });
}
