import type { SearchObject } from "imapflow";
import { definePlatformActions, type PlatformActionHandler } from "onebots";
import {
    canonicalBase64,
    exactParams,
    flagList,
    invalid,
    mailboxPath,
    optionalFlagList,
    optionalInteger,
    optionalMailboxPath,
    optionalString,
    optionalStringList,
    requireBoolean,
    requireDate,
    requireInteger,
    requireIntegers,
    requireString,
    stringList,
} from "./action-validation.js";
import type { EmailClient } from "./client.js";
import { EmailError } from "./errors.js";
import { validateEmailHeaders } from "./messages.js";
import type { EmailMailboxStatusQuery } from "./mailbox-native.js";
import type { EmailOutgoingAttachment, EmailSendOptions } from "./types.js";

const ACTION_HANDLERS = {
    send_email: emailAction(
        [
            "to",
            "subject",
            "text",
            "html",
            "cc",
            "bcc",
            "reply_to",
            "in_reply_to",
            "references",
            "priority",
            "headers",
            "attachments",
        ],
        (client, params) => client.sendEmail(sendOptions(params)),
    ),
    get_email: emailAction(["uid", "message_id", "mailbox"], (client, params) => {
        const mailbox = optionalMailboxPath(params.mailbox, "mailbox");
        const hasUid = params.uid !== undefined;
        const hasMessageId = params.message_id !== undefined;
        if (hasUid === hasMessageId) throw invalid("uid/message_id");
        return hasUid
            ? client.getEmail(requireInteger(params.uid, "uid"), mailbox)
            : client.findEmail(requireString(params.message_id, "message_id"), mailbox);
    }),
    search_emails: emailAction(["query", "mailbox", "limit"], (client, params) =>
        client.searchEmails(searchObject(params.query), {
            mailbox: optionalMailboxPath(params.mailbox, "mailbox"),
            limit: optionalInteger(params.limit, "limit"),
        }),
    ),
    list_mailboxes: emailAction([], client => client.listMailboxes()),
    get_mailbox_status: emailAction(["path", "query"], (client, params) =>
        client.executeMailboxNative({
            type: "status",
            path: mailboxPath(params.path, "path"),
            query: mailboxStatusQuery(params.query),
        }),
    ),
    get_mailbox_quota: emailAction(["path"], (client, params) =>
        client.executeMailboxNative({
            type: "quota",
            path: optionalMailboxPath(params.path, "path"),
        }),
    ),
    noop_imap: emailAction([], client => client.executeMailboxNative({ type: "noop" })),
    append_raw_email: emailAction(
        ["mailbox", "data_base64", "flags", "internal_date"],
        (client, params) =>
            client.executeMailboxNative({
                type: "append",
                path: mailboxPath(params.mailbox, "mailbox"),
                content: canonicalBase64(params.data_base64, "data_base64"),
                flags: optionalFlagList(params.flags, "flags"),
                internalDate:
                    params.internal_date === undefined
                        ? undefined
                        : requireDate(params.internal_date, "internal_date"),
            }),
    ),
    mark_email_read: emailAction(["uids", "mailbox"], (client, params) =>
        updateFlag(client, params, "\\Seen", "add"),
    ),
    mark_email_unread: emailAction(["uids", "mailbox"], (client, params) =>
        updateFlag(client, params, "\\Seen", "remove"),
    ),
    flag_email: emailAction(["uids", "mailbox"], (client, params) =>
        updateFlag(client, params, "\\Flagged", "add"),
    ),
    unflag_email: emailAction(["uids", "mailbox"], (client, params) =>
        updateFlag(client, params, "\\Flagged", "remove"),
    ),
    move_email: emailAction(["uids", "destination", "mailbox"], (client, params) =>
        client.moveEmails(
            requireIntegers(params.uids, "uids"),
            mailboxPath(params.destination, "destination"),
            optionalMailboxPath(params.mailbox, "mailbox"),
        ),
    ),
    copy_email: emailAction(["uids", "destination", "mailbox"], (client, params) =>
        client.copyEmails(
            requireIntegers(params.uids, "uids"),
            mailboxPath(params.destination, "destination"),
            optionalMailboxPath(params.mailbox, "mailbox"),
        ),
    ),
    set_email_flags: emailAction(["uids", "flags", "mailbox"], (client, params) =>
        client.updateFlags(
            requireIntegers(params.uids, "uids"),
            flagList(params.flags, "flags"),
            "set",
            optionalMailboxPath(params.mailbox, "mailbox"),
        ),
    ),
    add_email_flags: emailAction(["uids", "flags", "mailbox"], (client, params) =>
        client.updateFlags(
            requireIntegers(params.uids, "uids"),
            flagList(params.flags, "flags"),
            "add",
            optionalMailboxPath(params.mailbox, "mailbox"),
        ),
    ),
    remove_email_flags: emailAction(["uids", "flags", "mailbox"], (client, params) =>
        client.updateFlags(
            requireIntegers(params.uids, "uids"),
            flagList(params.flags, "flags"),
            "remove",
            optionalMailboxPath(params.mailbox, "mailbox"),
        ),
    ),
    delete_email: emailAction(["uids", "mailbox"], (client, params) =>
        client.deleteEmails(
            requireIntegers(params.uids, "uids"),
            optionalMailboxPath(params.mailbox, "mailbox"),
        ),
    ),
    create_mailbox: emailAction(["path"], (client, params) =>
        client.manageMailbox("create", mailboxPath(params.path, "path")),
    ),
    rename_mailbox: emailAction(["path", "new_path"], (client, params) =>
        client.manageMailbox(
            "rename",
            mailboxPath(params.path, "path"),
            mailboxPath(params.new_path, "new_path"),
        ),
    ),
    delete_mailbox: emailAction(["path"], (client, params) =>
        client.manageMailbox("delete", mailboxPath(params.path, "path")),
    ),
    subscribe_mailbox: emailAction(["path"], (client, params) =>
        client.manageMailbox("subscribe", mailboxPath(params.path, "path")),
    ),
    unsubscribe_mailbox: emailAction(["path"], (client, params) =>
        client.manageMailbox("unsubscribe", mailboxPath(params.path, "path")),
    ),
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

function emailAction(
    fields: readonly string[],
    handler: PlatformActionHandler<EmailClient>,
): PlatformActionHandler<EmailClient> {
    return async (client, params) => {
        exactParams(params, fields);
        return handler(client, params);
    };
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
        optionalMailboxPath(params.mailbox, "mailbox"),
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
        exactParams(item, [
            "filename",
            "content",
            "path",
            "href",
            "content_type",
            "cid",
            "disposition",
        ]);
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
    exactParams(value, [
        "answered",
        "deleted",
        "draft",
        "flagged",
        "seen",
        "all",
        "new",
        "old",
        "recent",
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
        "larger",
        "smaller",
        "seq",
        "uid",
        "modseq",
        "before",
        "on",
        "since",
        "sentBefore",
        "sentOn",
        "sentSince",
        "header",
        "not",
        "or",
        "labels",
    ]);
    if (Object.keys(value).length === 0) throw invalid("query");
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
    exactParams(value, ["has", "not"]);
    return {
        has: optionalStringList(value.has, "query.labels.has"),
        not: optionalStringList(value.not, "query.labels.not"),
    };
}

function searchHeaders(value: unknown): Record<string, boolean | string> {
    if (!isRecord(value)) throw invalid("query.header");
    const result: Record<string, boolean | string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!/^[A-Za-z0-9-]+$/u.test(key)) throw invalid(`query.header.${key}`);
        if (typeof item !== "boolean" && typeof item !== "string") {
            throw invalid(`query.header.${key}`);
        }
        result[key] = item;
    }
    return result;
}

function mailboxStatusQuery(value: unknown): EmailMailboxStatusQuery {
    const defaults: EmailMailboxStatusQuery = {
        messages: true,
        recent: true,
        uidNext: true,
        uidValidity: true,
        unseen: true,
        highestModseq: true,
    };
    if (value === undefined) return defaults;
    if (!isRecord(value)) throw invalid("query");
    exactParams(value, [
        "messages",
        "recent",
        "uidNext",
        "uidValidity",
        "unseen",
        "highestModseq",
        "size",
        "deleted",
    ]);
    if (Object.keys(value).length === 0) throw invalid("query");
    const result: EmailMailboxStatusQuery = {};
    for (const field of Object.keys(value) as Array<keyof EmailMailboxStatusQuery>) {
        result[field] = requireBoolean(value[field], `query.${field}`);
    }
    return result;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
