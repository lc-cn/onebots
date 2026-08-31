import { describe, expect, it, vi } from "vitest";
import {
    createRuntimeShutdownCoordinator,
    type RuntimeShutdownApp,
    type RuntimeShutdownDependencies,
} from "./runtime-shutdown.js";

function createHarness(stop: RuntimeShutdownApp["stop"]) {
    let forceExit: (() => void) | undefined;
    const timer = { unref: vi.fn() };
    const dependencies: RuntimeShutdownDependencies = {
        setExitCode: vi.fn(),
        exit: vi.fn(),
        setTimer: vi.fn(callback => {
            forceExit = callback;
            return timer;
        }),
        clearTimer: vi.fn(),
    };
    const app: RuntimeShutdownApp = {
        stop,
        enhancedLogger: {
            error: vi.fn(),
            fatal: vi.fn(),
        },
    };
    return { app, dependencies, timer, invokeForceExit: () => forceExit?.() };
}

describe("runtime shutdown coordination", () => {
    it("stops once, clears the fallback and records a clean exit", async () => {
        const harness = createHarness(vi.fn(async () => undefined));
        const onBegin = vi.fn();
        const coordinator = createRuntimeShutdownCoordinator(
            harness.app,
            { timeoutMs: 50, onBegin },
            harness.dependencies,
        );

        await Promise.all([coordinator.shutdown("SIGTERM"), coordinator.shutdown("SIGINT")]);

        expect(onBegin).toHaveBeenCalledOnce();
        expect(harness.app.stop).toHaveBeenCalledOnce();
        expect(harness.dependencies.setTimer).toHaveBeenCalledWith(expect.any(Function), 50);
        expect(harness.timer.unref).toHaveBeenCalledOnce();
        expect(harness.dependencies.clearTimer).toHaveBeenCalledWith(harness.timer);
        expect(harness.dependencies.setExitCode).toHaveBeenCalledWith(0);
        expect(harness.dependencies.exit).not.toHaveBeenCalled();
    });

    it("keeps the fallback armed when graceful stop rejects", async () => {
        const error = new Error("WebSocket 关闭失败");
        const harness = createHarness(vi.fn(async () => Promise.reject(error)));
        const coordinator = createRuntimeShutdownCoordinator(
            harness.app,
            { timeoutMs: 75 },
            harness.dependencies,
        );

        await coordinator.shutdown("SIGTERM");

        expect(harness.dependencies.clearTimer).not.toHaveBeenCalled();
        expect(harness.dependencies.setExitCode).toHaveBeenCalledWith(1);
        expect(harness.app.enhancedLogger.error).toHaveBeenCalledWith("SIGTERM 关闭失败", {
            error,
        });
        harness.invokeForceExit();
        expect(harness.app.enhancedLogger.fatal).toHaveBeenCalledWith(
            "优雅关闭失败后进程仍未退出，超过 75ms 后强制退出",
        );
        expect(harness.dependencies.exit).toHaveBeenCalledWith(1);
    });

    it("forces a hung shutdown after the bounded timeout", () => {
        const harness = createHarness(vi.fn(() => new Promise<void>(() => undefined)));
        const coordinator = createRuntimeShutdownCoordinator(
            harness.app,
            { timeoutMs: 100 },
            harness.dependencies,
        );

        void coordinator.shutdown("SIGINT");
        harness.invokeForceExit();

        expect(coordinator.isShuttingDown()).toBe(true);
        expect(harness.app.stop).toHaveBeenCalledOnce();
        expect(harness.app.enhancedLogger.fatal).toHaveBeenCalledWith(
            "优雅关闭超过 100ms，强制退出",
        );
        expect(harness.dependencies.exit).toHaveBeenCalledWith(1);
    });
});
