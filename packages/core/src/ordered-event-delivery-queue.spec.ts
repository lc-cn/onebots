import { describe, expect, it, vi } from "vitest";
import { OrderedEventDeliveryQueue } from "./ordered-event-delivery-queue.js";

describe("OrderedEventDeliveryQueue", () => {
    it("严格按入队顺序等待业务投递", async () => {
        let releaseFirst!: () => void;
        const firstBlocked = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const started: number[] = [];
        const queue = new OrderedEventDeliveryQueue<number>({
            dispatch: async event => {
                started.push(event);
                if (event === 1) await firstBlocked;
            },
        });
        queue.start();

        const first = queue.enqueue(1);
        const second = queue.enqueue(2);
        await Promise.resolve();
        expect(started).toEqual([1]);

        releaseFirst();
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(started).toEqual([1, 2]);
        expect(queue.pending).toBe(0);
    });

    it("失败事件成功前持续退避且不越过后续事件", async () => {
        const attempts: string[] = [];
        const delays: number[] = [];
        const retries = vi.fn();
        const queue = new OrderedEventDeliveryQueue<string>({
            retryDelaysMs: [10, 20],
            dispatch: event => {
                attempts.push(event);
                if (event === "first" && attempts.filter(value => value === event).length < 3) {
                    throw new Error("temporary");
                }
            },
            sleep: async delay => {
                delays.push(delay);
            },
            onRetry: retries,
        });
        queue.start();

        await Promise.all([queue.enqueue("first"), queue.enqueue("second")]);

        expect(attempts).toEqual(["first", "first", "first", "second"]);
        expect(delays).toEqual([10, 20]);
        expect(retries).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ attempt: 2, delayMs: 20, pending: 2 }),
        );
    });

    it("停止时取消旧代次并允许新代次独立工作", async () => {
        const queue = new OrderedEventDeliveryQueue<string>({
            retryDelaysMs: [60_000],
            dispatch: event => {
                if (event !== "new") throw new Error("unavailable");
            },
        });
        queue.start();
        const current = queue.enqueue("current");
        const waiting = queue.enqueue("waiting");
        await Promise.resolve();

        queue.stop();
        await expect(current).resolves.toBe(false);
        await expect(waiting).resolves.toBe(false);

        queue.start();
        await expect(queue.enqueue("new")).resolves.toBe(true);
    });

    it("按指数阈值报告积压但不丢弃事件", async () => {
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        const backlogs: number[] = [];
        const queue = new OrderedEventDeliveryQueue<number>({
            backlogWarningThreshold: 2,
            dispatch: () => blocked,
            onBacklog: pending => backlogs.push(pending),
        });
        queue.start();

        const deliveries = [1, 2, 3, 4].map(event => queue.enqueue(event));
        expect(backlogs).toEqual([2, 4]);
        expect(queue.pending).toBe(4);

        queue.stop();
        release();
        await expect(Promise.all(deliveries)).resolves.toEqual([false, false, false, false]);
    });

    it("拒绝无法形成稳定退避策略的配置", () => {
        expect(
            () =>
                new OrderedEventDeliveryQueue({
                    retryDelaysMs: [],
                    dispatch: () => undefined,
                }),
        ).toThrow("retryDelaysMs");
        expect(
            () =>
                new OrderedEventDeliveryQueue({
                    backlogWarningThreshold: 0,
                    dispatch: () => undefined,
                }),
        ).toThrow("backlogWarningThreshold");
    });
});
