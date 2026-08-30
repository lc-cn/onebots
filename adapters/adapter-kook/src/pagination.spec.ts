import { describe, expect, test, vi } from "vitest";
import { collectKookPages, KOOK_MAX_PAGE_SIZE } from "./pagination.js";

describe("KOOK 分页收集器", () => {
    test("始终使用官方 50 条上限并收集所有页", async () => {
        const loadPage = vi.fn(async (page: number, pageSize: number) => ({
            items: [`item-${page}`],
            meta: { page, page_size: pageSize, page_total: 3 },
        }));

        await expect(collectKookPages(loadPage)).resolves.toEqual(["item-1", "item-2", "item-3"]);
        expect(loadPage).toHaveBeenCalledTimes(3);
        expect(loadPage.mock.calls).toEqual([
            [1, KOOK_MAX_PAGE_SIZE],
            [2, KOOK_MAX_PAGE_SIZE],
            [3, KOOK_MAX_PAGE_SIZE],
        ]);
    });

    test("拒绝异常分页元数据而不是失控请求", async () => {
        await expect(
            collectKookPages(async () => ({ items: [], meta: { page_total: 0 } })),
        ).rejects.toMatchObject({ code: "KOOK_PAGINATION_INVALID" });
    });
});
