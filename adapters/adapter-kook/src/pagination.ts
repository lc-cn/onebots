import { KookError } from "./errors.js";
import type { KookListResponse } from "./types.js";

/** KOOK 常规列表接口的官方单页上限。 */
export const KOOK_MAX_PAGE_SIZE = 50;

export type KookPageLoader<T> = (page: number, pageSize: number) => Promise<KookListResponse<T>>;

/** 按官方分页上限顺序收集全部结果，并拒绝异常的分页 envelope。 */
export async function collectKookPages<T>(loadPage: KookPageLoader<T>): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
        const response = await loadPage(page, KOOK_MAX_PAGE_SIZE);
        if (!response || !Array.isArray(response.items)) {
            throw KookError.invalid("KOOK 分页响应缺少 items 数组", "KOOK_PAGINATION_INVALID", {
                page,
                response,
            });
        }
        items.push(...response.items);
        const pageTotal = response.meta?.page_total;
        if (pageTotal === undefined) break;
        if (!Number.isInteger(pageTotal) || pageTotal < 1) {
            throw KookError.invalid("KOOK 分页响应的 page_total 无效", "KOOK_PAGINATION_INVALID", {
                page,
                page_total: pageTotal,
            });
        }
        if (page >= pageTotal) break;
    }
    return items;
}
