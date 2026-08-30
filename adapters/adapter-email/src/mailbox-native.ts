import type { ImapFlow, QuotaResponse } from "imapflow";

export interface EmailMailboxStatusQuery {
    messages?: boolean;
    recent?: boolean;
    uidNext?: boolean;
    uidValidity?: boolean;
    unseen?: boolean;
    highestModseq?: boolean;
    size?: boolean;
    deleted?: boolean;
}

export type EmailMailboxNativeCommand =
    | { type: "status"; path: string; query: EmailMailboxStatusQuery }
    | { type: "quota"; path?: string }
    | { type: "noop" }
    | {
          type: "append";
          path: string;
          content: Buffer;
          flags?: string[];
          internalDate?: string | Date;
      };

export interface EmailMailboxStatusResult {
    path: string;
    messages?: number;
    recent?: number;
    uidNext?: number;
    uidValidity?: string;
    unseen?: number;
    highestModseq?: string;
    size?: number;
    deleted?: number;
}

export interface EmailAppendResult {
    destination: string;
    uidValidity?: string;
    uid?: number;
    seq?: number;
}

export type EmailMailboxNativeResult =
    | EmailMailboxStatusResult
    | QuotaResponse
    | EmailAppendResult
    | { ok: true }
    | false;

/** 闭合少量有稳定语义的 IMAP 原生命令，不向平台动作暴露任意客户端反射。 */
export async function executeEmailMailboxNativeCommand(
    imap: ImapFlow,
    command: EmailMailboxNativeCommand,
): Promise<EmailMailboxNativeResult> {
    if (command.type === "status") {
        const status = await imap.status(command.path, command.query);
        return {
            ...status,
            uidValidity: status.uidValidity?.toString(),
            highestModseq: status.highestModseq?.toString(),
        };
    }
    if (command.type === "quota") return imap.getQuota(command.path);
    if (command.type === "noop") {
        await imap.noop();
        return { ok: true };
    }
    const appended = await imap.append(
        command.path,
        command.content,
        command.flags,
        command.internalDate,
    );
    return appended
        ? { ...appended, uidValidity: appended.uidValidity?.toString() }
        : false;
}
