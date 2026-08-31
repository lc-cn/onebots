import { describe, expect, it, vi } from "vitest";
import { mapConcurrent, RefreshableValue } from "./async-utils.js";

describe("RefreshableValue", () => {
    it("合并并发加载并只失效调用方实际使用的代次", async () => {
        const cache = new RefreshableValue<string>();
        const loader = vi.fn().mockResolvedValue({ value: "old", ttlMs: 1_000 });
        await expect(Promise.all([cache.get(loader), cache.get(loader)])).resolves.toEqual([
            "old",
            "old",
        ]);
        expect(loader).toHaveBeenCalledTimes(1);

        await cache.get(async () => ({ value: "new", ttlMs: 1_000 }), true);
        expect(cache.invalidate("old")).toBe(false);
        await expect(cache.get(loader)).resolves.toBe("new");
    });

    it("clear 后不会让未完成加载重新写回缓存", async () => {
        let resolve!: (value: { value: string; ttlMs: number }) => void;
        const loader = vi.fn(
            () => new Promise<{ value: string; ttlMs: number }>(done => (resolve = done)),
        );
        const cache = new RefreshableValue<string>();
        const pending = cache.get(loader);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
        cache.clear();
        resolve({ value: "stale", ttlMs: 1_000 });
        await expect(pending).resolves.toBe("stale");
        await expect(cache.get(async () => ({ value: "fresh", ttlMs: 1_000 }))).resolves.toBe(
            "fresh",
        );
        expect(loader).toHaveBeenCalledTimes(1);
    });
});

describe("mapConcurrent", () => {
    it("限制并发并保持输入顺序", async () => {
        let active = 0;
        let maximum = 0;
        const result = await mapConcurrent([3, 1, 2, 0], 2, async value => {
            active += 1;
            maximum = Math.max(maximum, active);
            await Promise.resolve();
            active -= 1;
            return value * 2;
        });
        expect(result).toEqual([6, 2, 4, 0]);
        expect(maximum).toBe(2);
    });

    it("拒绝会静默丢失工作的非法并发数", async () => {
        await expect(mapConcurrent([1], 0, value => value)).rejects.toThrow("concurrency");
    });
});
