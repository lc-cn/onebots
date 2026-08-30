import type { WhatsAppPaging } from "./types.js";

type InvalidResponse = (root: unknown) => never;

/** 统一校验 Graph API cursor 分页，避免领域模块各自放宽 URL 与 cursor 结构。 */
export function parseWhatsAppPaging(
    value: unknown,
    root: unknown,
    invalidResponse: InvalidResponse,
): WhatsAppPaging {
    const source = responseRecord(value, root, invalidResponse);
    const cursors =
        source.cursors === undefined
            ? undefined
            : responseRecord(source.cursors, root, invalidResponse);
    return {
        ...(cursors ? { cursors: cursorPair(cursors, root, invalidResponse) } : {}),
        ...(source.previous === undefined
            ? {}
            : { previous: httpsUrl(source.previous, root, invalidResponse) }),
        ...(source.next === undefined
            ? {}
            : { next: httpsUrl(source.next, root, invalidResponse) }),
    };
}

function cursorPair(
    source: Readonly<Record<string, unknown>>,
    root: unknown,
    invalidResponse: InvalidResponse,
): NonNullable<WhatsAppPaging["cursors"]> {
    return {
        ...(source.before === undefined
            ? {}
            : { before: responseText(source.before, root, invalidResponse) }),
        ...(source.after === undefined
            ? {}
            : { after: responseText(source.after, root, invalidResponse) }),
    };
}

function httpsUrl(value: unknown, root: unknown, invalidResponse: InvalidResponse): string {
    const text = responseText(value, root, invalidResponse);
    if (!URL.canParse(text)) invalidResponse(root);
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) invalidResponse(root);
    return text;
}

function responseRecord(
    value: unknown,
    root: unknown,
    invalidResponse: InvalidResponse,
): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse(root);
    return value as Record<string, unknown>;
}

function responseText(value: unknown, root: unknown, invalidResponse: InvalidResponse): string {
    if (typeof value !== "string" || !value.trim()) invalidResponse(root);
    return value;
}
