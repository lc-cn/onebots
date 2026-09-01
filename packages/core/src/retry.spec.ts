import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "./retry.js";

describe("ConnectionManager cancellation", () => {
    it("把外部取消传给未完成连接并拒绝迟到成功回调", async () => {
        const external = new AbortController();
        let release: (() => void) | undefined;
        let receivedSignal: AbortSignal | undefined;
        const onConnected = vi.fn();
        const manager = new ConnectionManager(
            async signal => {
                receivedSignal = signal;
                await new Promise<void>(resolve => {
                    release = resolve;
                });
            },
            { maxRetries: 0 },
            { onConnected },
        );

        const starting = manager.start(external.signal);
        await Promise.resolve();
        external.abort();

        expect(receivedSignal?.aborted).toBe(true);
        release?.();
        await starting;
        expect(onConnected).not.toHaveBeenCalled();
    });

    it("停止时中止当前连接且不会安排失败重试", async () => {
        vi.useFakeTimers();
        try {
            const connect = vi.fn(
                async (signal?: AbortSignal) =>
                    new Promise<void>((_, reject) => {
                        signal?.addEventListener(
                            "abort",
                            () => reject(new Error("connection aborted")),
                            { once: true },
                        );
                    }),
            );
            const manager = new ConnectionManager(connect, {
                maxRetries: 3,
                initialDelay: 1,
                jitter: false,
            });

            const starting = manager.start();
            await Promise.resolve();
            manager.stop();
            await starting;
            await vi.runAllTimersAsync();

            expect(connect).toHaveBeenCalledOnce();
            expect(manager.getAttempts()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
