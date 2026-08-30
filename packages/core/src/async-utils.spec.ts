import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
    emitAllAwaited,
    emitAwaited,
    FailureCollector,
    KeyedSingleFlight,
    mapConcurrent,
    RefreshableValue,
} from "./async-utils.js";

describe("FailureCollector", () => {
    it("尝试全部清理步骤并汇总多个失败", async () => {
        const failures = new FailureCollector();
        const completed = vi.fn();
        await failures.capture(async () => {
            throw new Error("first");
        });
        await failures.capture(completed);
        await failures.capture(
            async () => {
                throw new Error("second");
            },
            () => {
                throw new Error("reporter");
            },
        );

        expect(completed).toHaveBeenCalledOnce();
        expect(failures.size).toBe(3);
        expect(() => failures.throwIfAny("cleanup failed")).toThrow(
            expect.objectContaining({ errors: expect.arrayContaining([expect.any(Error)]) }),
        );
    });

    it("单个失败保持原始错误身份", async () => {
        const expected = new Error("only");
        const failures = new FailureCollector();
        await failures.capture(() => Promise.reject(expected));
        expect(() => failures.throwIfAny("cleanup failed")).toThrow(expected);
    });
});

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

describe("emitAwaited", () => {
    it("按注册顺序等待异步监听器并传播失败", async () => {
        const emitter = new EventEmitter();
        const calls: string[] = [];
        emitter.on("event", async () => {
            await Promise.resolve();
            calls.push("first");
        });
        emitter.on("event", () => {
            calls.push("second");
            throw new Error("delivery failed");
        });

        await expect(emitAwaited(emitter, "event", { id: "e1" })).rejects.toThrow(
            "delivery failed",
        );
        expect(calls).toEqual(["first", "second"]);
    });

    it("保留 once 监听器只执行一次的语义", async () => {
        const emitter = new EventEmitter();
        const listener = vi.fn();
        emitter.once("event", listener);
        await emitAwaited(emitter, "event");
        await emitAwaited(emitter, "event");
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe("emitAllAwaited", () => {
    it("监听器失败后继续投递其余出口，并在最后传播错误", async () => {
        const emitter = new EventEmitter();
        const delivered = vi.fn();
        emitter.on("event", async () => {
            await Promise.resolve();
            throw new Error("first failed");
        });
        emitter.on("event", delivered);

        await expect(emitAllAwaited(emitter, "event", "payload")).rejects.toThrow("first failed");
        expect(delivered).toHaveBeenCalledWith("payload");
    });
});

describe("KeyedSingleFlight", () => {
    it("合并同键并发工作，并在失败后允许重试", async () => {
        const flights = new KeyedSingleFlight<string, string>();
        let reject!: (reason: Error) => void;
        const task = vi.fn(() => new Promise<string>((_resolve, fail) => (reject = fail)));
        const first = flights.run("same", task);
        const second = flights.run("same", task);
        await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
        reject(new Error("retry me"));
        await expect(first).rejects.toThrow("retry me");
        await expect(second).rejects.toThrow("retry me");
        await expect(flights.run("same", async () => "ok")).resolves.toBe("ok");
    });

    it("先登记航班再同步启动任务，允许调用方立即观察初始化状态", async () => {
        const flights = new KeyedSingleFlight<string, string>();
        const states: string[] = [];
        const result = flights.run("key", () => {
            states.push("started");
            return "done";
        });
        expect(states).toEqual(["started"]);
        await expect(result).resolves.toBe("done");
    });
});
