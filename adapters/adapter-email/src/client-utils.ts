import type { FetchMessageObject } from "imapflow";
import { EmailError } from "./errors.js";
import { parseEmailSource } from "./events.js";
import type { EmailMessage } from "./types.js";

export async function parseFetched(
    messages: FetchMessageObject[],
    mailbox: string,
): Promise<EmailMessage[]> {
    const result: EmailMessage[] = [];
    for (const message of messages) {
        if (message.source)
            result.push(await parseEmailSource(message.uid, mailbox, message.source));
    }
    return result;
}

export function emailNotFound(uid: number, mailbox: string): EmailError {
    return new EmailError(`邮箱目录 ${mailbox} 中不存在 UID ${uid}`, { code: "EMAIL_NOT_FOUND" });
}

export function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(abortReason(signal));
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortReason(signal));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, delayMs);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

export function mutableAddress(
    value: string | readonly string[] | undefined,
): string | string[] | undefined {
    if (typeof value === "string" || value === undefined) return value;
    return [...value];
}

function abortReason(signal: AbortSignal): unknown {
    return signal.reason || new DOMException("Aborted", "AbortError");
}
