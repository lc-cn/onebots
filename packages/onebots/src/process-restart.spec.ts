import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleProcessRestart } from "./process-restart.js";

afterEach(() => {
    vi.useRealTimers();
});

describe("process restart coordination", () => {
    it("stops application resources before exiting with the supervisor restart code", async () => {
        vi.useFakeTimers();
        const order: string[] = [];
        const app = {
            stop: vi.fn(async () => {
                order.push("stop");
            }),
            logger: { error: vi.fn() },
        };

        expect(
            scheduleProcessRestart(app, {
                exitCode: 75,
                delayMs: 10,
                exit: code => order.push(`exit:${code}`),
            }),
        ).toBe(true);
        expect(scheduleProcessRestart(app, { exitCode: 75 })).toBe(false);
        await vi.advanceTimersByTimeAsync(10);

        expect(order).toEqual(["stop", "exit:75"]);
        expect(app.logger.error).not.toHaveBeenCalled();
    });

    it("records a stop timeout and still hands control back to the supervisor", async () => {
        vi.useFakeTimers();
        const exit = vi.fn();
        const app = {
            stop: vi.fn(() => new Promise<void>(() => undefined)),
            logger: { error: vi.fn() },
        };

        scheduleProcessRestart(app, {
            exitCode: 75,
            delayMs: 10,
            stopTimeoutMs: 20,
            exit,
        });
        await vi.advanceTimersByTimeAsync(30);

        expect(app.logger.error).toHaveBeenCalledWith(
            "服务重启前的优雅停机失败，将由守护进程强制切换实例",
            { error: expect.objectContaining({ message: "优雅停机超过 20ms" }) },
        );
        expect(exit).toHaveBeenCalledWith(75);
    });
});
