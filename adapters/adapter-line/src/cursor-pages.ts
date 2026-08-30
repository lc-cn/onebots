import { invalidParams } from "./platform-action-params.js";

export interface CursorPage<T> {
    readonly items: readonly T[];
    readonly next?: string;
}

/** 拉取全部游标页，并拒绝会让 SDK 永久循环的重复游标。 */
export async function collectCursorPages<T>(
    initialCursor: string | undefined,
    fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    let cursor = initialCursor;
    while (true) {
        if (cursor) {
            if (seen.has(cursor)) throw invalidParams("LINE 分页响应返回了重复游标");
            seen.add(cursor);
        }
        const page = await fetchPage(cursor);
        result.push(...page.items);
        if (!page.next) return result;
        cursor = page.next;
    }
}
