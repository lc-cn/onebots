import type { SearchObject } from "imapflow";
import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { EmailClient } from "./client.js";
import { EmailError } from "./errors.js";
import { validateEmailHeaders } from "./messages.js";
import type { EmailOutgoingAttachment, EmailSendOptions } from "./types.js";

const ACTION_HANDLERS = {
    send_email: (client, params) => client.sendEmail(sendOptions(params)),
    get_email: (client, params) =>
        params.uid === undefined
            ? client.findEmail(
                  requireString(params.message_id, "message_id"),
                  optionalString(params.mailbox, "mailbox"),
              )
            : client.getEmail(
                  requireInteger(params.uid, "uid"),
                  optionalString(params.mailbox, "mailbox"),
              ),
    search_emails: (client, params) =>
        client.searchEmails(searchObject(params.query), {
            mailbox: optionalString(params.mailbox, "mailbox"),
            limit: optionalInteger(params.limit, "limit"),
        }),
    list_mailboxes: client => client.listMailboxes(),
    mark_email_read: (client, params) => updateFlag(client, params, "\\Seen", "add"),
    mark_email_unread: (client, params) => updateFlag(client, params, "\\Seen", "remove"),
    flag_email: (client, params) => updateFlag(client, params, "\\Flagged", "add"),
    unflag_email: (client, params) => updateFlag(client, params, "\\Flagged", "remove"),
    move_email: (client, params) =>
        client.moveEmails(
            requireIntegers(params.uids, "uids"),
            requireString(params.destination, "destination"),
            optionalString(params.mailbox, "mailbox"),
        ),
    copy_email: (client, params) =>
        client.copyEmails(
            requireIntegers(params.uids, "uids"),
            requireString(params.destination, "destination"),
            optionalString(params.mailbox, "mailbox"),
        ),
    add_email_flags: (client, params) =>
        client.updateFlags(
            requireIntegers(params.uids, "uids"),
            stringList(params.flags, "flags"),
            "add",
            optionalString(params.mailbox, "mailbox"),
        ),
    remove_email_flags: (client, params) =>
        client.updateFlags(
            requireIntegers(params.uids, "uids"),
            stringList(params.flags, "flags"),
            "remove",
            optionalString(params.mailbox, "mailbox"),
        ),
    delete_email: (client, params) =>
        client.deleteEmails(
            requireIntegers(params.uids, "uids"),
            optionalString(params.mailbox, "mailbox"),
        ),
    create_mailbox: (client, params) =>
        client.manageMailbox("create", requireString(params.path, "path")),
    rename_mailbox: (client, params) =>
        client.manageMailbox(
            "rename",
            requireString(params.path, "path"),
            requireString(params.new_path, "new_path"),
        ),
    delete_mailbox: (client, params) =>
        client.manageMailbox("delete", requireString(params.path, "path")),
    subscribe_mailbox: (client, params) =>
        client.manageMailbox("subscribe", requireString(params.path, "path")),
    unsubscribe_mailbox: (client, params) =>
        client.manageMailbox("unsubscribe", requireString(params.path, "path")),
} satisfies Readonly<Record<string, PlatformActionHandler<EmailClient>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    ACTION_HANDLERS,
    action =>
        new EmailError(`未实现邮件平台动作: ${action}`, {
            code: "EMAIL_ACTION_NOT_IMPLEMENTED",
        }),
);

export const EMAIL_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type EmailPlatformAction =
    typeof EMAIL_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 执行经过白名单和参数校验的 SMTP/IMAP 原生动作。 */
export async function executeEmailPlatformAction(
    client: EmailClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}

function updateFlag(
    client: EmailClient,
    params: Readonly<Record<string, unknown>>,
    flag: string,
    operation: "add" | "remove",
): Promise<void> {
    return client.updateFlags(
        requireIntegers(params.uids, "uids"),
        [flag],
        operation,
        optionalString(params.mailbox, "mailbox"),
    );
}

function sendOptions(params: Readonly<Record<string, unknown>>): EmailSendOptions {
    return {
        to: stringList(params.to, "to"),
        subject: requireString(params.subject, "subject"),
        text: optionalString(params.text, "text"),
        html: optionalString(params.html, "html"),
        cc: optionalStringList(params.cc, "cc"),
        bcc: optionalStringList(params.bcc, "bcc"),
        reply_to: optionalStringList(params.reply_to, "reply_to"),
        in_reply_to: optionalString(params.in_reply_to, "in_reply_to"),
        references: optionalStringList(params.references, "references"),
        priority: priority(params.priority),
        headers:
            params.headers === undefined
                ? undefined
                : validateEmailHeaders(params.headers, "headers"),
        attachments: attachments(params.attachments),
    };
}

function attachments(value: unknown): EmailOutgoingAttachment[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw invalid("attachments");
    return value.map((item, index) => {
        if (!isRecord(item)) throw invalid(`attachments[${index}]`);
        const content = attachmentContent(item.content, index);
        const path = optionalString(item.path, `attachments[${index}].path`);
        const href = optionalString(item.href, `attachments[${index}].href`);
        if ([content, path, href].filter(source => source !== undefined).length !== 1) {
            throw invalid(`attachments[${index}].source`);
        }
        return {
            filename: requireString(item.filename, `attachments[${index}].filename`),
            content,
            path,
            href,
            content_type: optionalString(item.content_type, `attachments[${index}].content_type`),
            cid: optionalString(item.cid, `attachments[${index}].cid`),
            disposition: attachmentDisposition(item.disposition, index),
        };
    });
}

function searchObject(value: unknown): SearchObject {
    if (!isRecord(value)) throw invalid("query");
    const result: SearchObject = {};
    for (const field of [
        "answered",
        "deleted",
        "draft",
        "flagged",
        "seen",
        "all",
        "new",
        "old",
        "recent",
    ] as const) {
        if (value[field] !== undefined)
            result[field] = requireBoolean(value[field], `query.${field}`);
    }
    for (const field of [
        "from",
        "to",
        "cc",
        "bcc",
        "body",
        "subject",
        "text",
        "keyword",
        "unKeyword",
        "gmraw",
        "gmailraw",
        "emailId",
        "threadId",
    ] as const) {
        if (value[field] !== undefined)
            result[field] = requireString(value[field], `query.${field}`);
    }
    for (const field of ["larger", "smaller"] as const) {
        if (value[field] !== undefined)
            result[field] = requireInteger(value[field], `query.${field}`);
    }
    for (const field of ["seq", "uid"] as const) {
        if (value[field] !== undefined) result[field] = sequence(value[field], `query.${field}`);
    }
    if (value.modseq !== undefined) result.modseq = bigInteger(value.modseq, "query.modseq");
    for (const field of ["before", "on", "since", "sentBefore", "sentOn", "sentSince"] as const) {
        if (value[field] !== undefined) result[field] = requireDate(value[field], `query.${field}`);
    }
    if (value.header !== undefined) result.header = searchHeaders(value.header);
    if (value.not !== undefined) result.not = searchObject(value.not);
    if (value.or !== undefined) {
        if (!Array.isArray(value.or) || value.or.length < 2) throw invalid("query.or");
        result.or = value.or.map(searchObject);
    }
    if (value.labels !== undefined) result.labels = labelSearch(value.labels);
    return result;
}

function priority(value: unknown): EmailSendOptions["priority"] {
    if (value === undefined) return undefined;
    if (value === "high" || value === "normal" || value === "low") return value;
    throw invalid("priority");
}

function stringList(value: unknown, field: string): string[] {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length) throw invalid(field);
    return values.map(item => requireString(item, field));
}

function optionalStringList(value: unknown, field: string): string[] | undefined {
    return value === undefined ? undefined : stringList(value, field);
}

function requireIntegers(value: unknown, field: string): number[] {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length) throw invalid(field);
    return values.map(item => requireInteger(item, field));
}

function requireInteger(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) throw invalid(field);
    return Number(value);
}

function requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw invalid(field);
    return value;
}

function requireDate(value: unknown, field: string): string | Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
    throw invalid(field);
}

function sequence(value: unknown, field: string): string | number | bigint {
    if (typeof value === "string" && value.trim()) return value.trim();
    if ((typeof value === "number" && Number.isSafeInteger(value)) || typeof value === "bigint") {
        return value;
    }
    throw invalid(field);
}

function bigInteger(value: unknown, field: string): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
    throw invalid(field);
}

function labelSearch(value: unknown): { has?: string[]; not?: string[] } {
    if (!isRecord(value)) throw invalid("query.labels");
    return {
        has: optionalStringList(value.has, "query.labels.has"),
        not: optionalStringList(value.not, "query.labels.not"),
    };
}

function searchHeaders(value: unknown): Record<string, boolean | string> {
    if (!isRecord(value)) throw invalid("query.header");
    const result: Record<string, boolean | string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== "boolean" && typeof item !== "string") {
            throw invalid(`query.header.${key}`);
        }
        result[key] = item;
    }
    return result;
}

function optionalInteger(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : requireInteger(value, field);
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw invalid(field);
    return value.trim();
}

function optionalString(value: unknown, field = "optional_string"): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function attachmentDisposition(
    value: unknown,
    index: number,
): EmailOutgoingAttachment["disposition"] {
    if (value === undefined) return undefined;
    if (value === "inline" || value === "attachment") return value;
    throw invalid(`attachments[${index}].disposition`);
}

function attachmentContent(value: unknown, index: number): Buffer | string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "string" || Buffer.isBuffer(value)) return value;
    throw invalid(`attachments[${index}].content`);
}

function invalid(field: string): EmailError {
    return new EmailError(`邮件动作参数 ${field} 无效`, { code: "EMAIL_INVALID_ACTION_PARAM" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
