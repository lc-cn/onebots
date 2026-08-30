import { ErrorCategory } from "onebots";
import { FeishuError } from "./errors.js";

export interface FeishuPage<T> {
    items?: T[];
    has_more?: boolean;
    page_token?: string;
}

/**
 * 遍历飞书游标分页，并拒绝会导致静默截断或无限请求的异常游标。
 *
 * 飞书以 `has_more` 表示后续页；为 true 时必须同时返回一个未使用过的
 * `page_token`。把这项约束集中在这里，所有目录资源共享一致的失败语义。
 */
export async function collectFeishuPages<T>(
    operation: string,
    fetchPage: (pageToken?: string) => Promise<FeishuPage<T>>,
): Promise<T[]> {
    const items: T[] = [];
    const visitedTokens = new Set<string>();
    let pageToken: string | undefined;

    while (true) {
        const page = await fetchPage(pageToken);
        items.push(...(page.items ?? []));
        if (!page.has_more) return items;

        const nextToken = page.page_token;
        if (!nextToken || visitedTokens.has(nextToken)) {
            throw new FeishuError(`飞书 ${operation} 返回了无效的分页游标`, {
                code: "FEISHU_PAGINATION_INVALID",
                category: ErrorCategory.PROTOCOL,
                operation,
                details: { page_token: nextToken, received_items: items.length },
            });
        }
        visitedTokens.add(nextToken);
        pageToken = nextToken;
    }
}
