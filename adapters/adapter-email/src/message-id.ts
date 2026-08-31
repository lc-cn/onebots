import { EmailError } from "./errors.js";

const IMAP_ID_PREFIX = "onebots-imap:v1:";

export interface ImapMessageLocation {
    mailbox: string;
    uid: number;
    uidValidity?: bigint;
}

/** 为缺少 RFC Message-ID 的邮件生成可逆且不受目录分隔符影响的原生标识。 */
export function createImapMessageId(mailbox: string, uid: number, uidValidity?: bigint): string {
    if (!mailbox || !Number.isSafeInteger(uid) || uid <= 0) {
        throw new EmailError("无法为无效的 IMAP 目录或 UID 生成消息 ID", {
            code: "EMAIL_INVALID_IMAP_IDENTITY",
            details: { mailbox, uid },
        });
    }
    if (uidValidity !== undefined && uidValidity <= 0n) {
        throw new EmailError("IMAP UIDVALIDITY 必须是正整数", {
            code: "EMAIL_INVALID_IMAP_IDENTITY",
            details: { mailbox, uid, uidValidity },
        });
    }
    const generation = uidValidity?.toString() ?? "-";
    return `${IMAP_ID_PREFIX}${Buffer.from(mailbox, "utf8").toString("base64url")}:${generation}:${uid}`;
}

/** 解析由 createImapMessageId 生成的标识；普通 RFC Message-ID 返回 undefined。 */
export function parseImapMessageId(value: string): ImapMessageLocation | undefined {
    if (!value.startsWith(IMAP_ID_PREFIX)) return undefined;
    const encoded = value.slice(IMAP_ID_PREFIX.length);
    const parts = encoded.split(":");
    if (parts.length !== 3) throw invalidIdentity(value);
    const [mailboxToken = "", generationToken = "", uidToken = ""] = parts;
    if (
        !/^[A-Za-z0-9_-]+$/.test(mailboxToken) ||
        !/^(?:-|[1-9]\d*)$/.test(generationToken) ||
        !/^[1-9]\d*$/.test(uidToken)
    ) {
        throw invalidIdentity(value);
    }
    const mailbox = Buffer.from(mailboxToken, "base64url").toString("utf8");
    const uid = Number(uidToken);
    const uidValidity = generationToken === "-" ? undefined : BigInt(generationToken);
    if (
        !mailbox ||
        !Number.isSafeInteger(uid) ||
        Buffer.from(mailbox, "utf8").toString("base64url") !== mailboxToken
    ) {
        throw invalidIdentity(value);
    }
    return { mailbox, uid, uidValidity };
}

function invalidIdentity(value: string): EmailError {
    return new EmailError("IMAP 消息 ID 结构无效", {
        code: "EMAIL_INVALID_IMAP_IDENTITY",
        details: value,
    });
}
