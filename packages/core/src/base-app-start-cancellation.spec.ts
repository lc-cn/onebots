import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Adapter } from "./adapter.js";
import { BaseApp } from "./base-app.js";

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

class TestApp extends BaseApp {
    listen = vi.fn(async (_signal?: AbortSignal) => undefined);
    protected override listenHttpServer(signal?: AbortSignal): Promise<void> {
        return this.listen(signal);
    }
}

class TestAdapter extends Adapter {
    startTask = vi.fn(async () => undefined);
    stopTask = vi.fn(async () => undefined);
    constructor(app: BaseApp) {
        super(app, "mock");
    }
    createAccount(): never {
        throw new Error("测试不创建账号");
    }
    override start(): Promise<void> {
        return this.startTask();
    }
    override stop(): Promise<void> {
        return this.stopTask();
    }
}

const originalConfigDir = BaseApp.configDir;
const fixtures: Array<{ app: TestApp; directory: string }> = [];
function createApp() {
    const directory = mkdtempSync(join(tmpdir(), "onebots-host-cancel-"));
    BaseApp.configDir = directory;
    const app = new TestApp({ database: "test.db" });
    fixtures.push({ app, directory });
    return app;
}

afterEach(async () => {
    await Promise.allSettled(fixtures.map(({ app }) => app.stop()));
    for (const { directory } of fixtures.splice(0))
        rmSync(directory, { recursive: true, force: true });
    BaseApp.configDir = originalConfigDir;
});

describe("BaseApp startup cancellation", () => {
    it("shares start and stop tasks and suppresses late lifecycle hooks and listening", async () => {
        const app = createApp();
        const pending = deferred();
        const entered = deferred();
        const secondHook = vi.fn();
        const stopHook = vi.fn();
        app.lifecycle.addHook({
            onStart: () => {
                entered.resolve();
                return pending.promise;
            },
            onStop: stopHook,
        });
        app.lifecycle.addHook({ onStart: secondHook });
        const starting = app.start();
        const result = expect(starting).rejects.toMatchObject({ name: "AbortError" });
        expect(app.start()).toBe(starting);
        await entered.promise;
        const stopping = app.stop();
        expect(app.stop()).toBe(stopping);
        await expect(app.start()).rejects.toThrow("不能再次启动");
        await stopping;
        pending.resolve();
        await result;
        expect(secondHook).not.toHaveBeenCalled();
        expect(app.listen).not.toHaveBeenCalled();
        expect(stopHook).toHaveBeenCalledOnce();
        expect(app.isDisposed).toBe(true);
        expect(app.isStarted).toBe(false);
    });

    it("cancels a queued start before any lifecycle hook runs", async () => {
        const app = createApp();
        const startHook = vi.fn();
        app.lifecycle.addHook({ onStart: startHook });
        const result = expect(app.start()).rejects.toMatchObject({ name: "AbortError" });
        await app.stop();
        await result;
        expect(startHook).not.toHaveBeenCalled();
        expect(app.listen).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        "does not start the next adapter after stop, late failure=%s",
        async fail => {
            const app = createApp();
            const pending = deferred();
            const entered = deferred();
            const first = new TestAdapter(app);
            const second = new TestAdapter(app);
            first.startTask.mockImplementation(() => {
                entered.resolve();
                return pending.promise;
            });
            app.adapters.set("mock", first);
            // Map keys are opaque to startup iteration; a second real adapter exercises the queue.
            app.adapters.set("second" as keyof Adapter.Configs, second);
            const starting = app.start();
            const result = expect(starting).rejects.toMatchObject({ name: "AbortError" });
            await entered.promise;
            await app.stop();
            if (fail) pending.reject(new Error("迟到失败"));
            else pending.resolve();
            await result;
            expect(second.startTask).not.toHaveBeenCalled();
            expect(first.stopTask).toHaveBeenCalledOnce();
            expect(second.stopTask).toHaveBeenCalledOnce();
            expect(app.isStarted).toBe(false);
        },
    );

    it("passes an aborted signal to an in-flight listener and never starts adapters afterwards", async () => {
        const app = createApp();
        const pending = deferred();
        const entered = deferred();
        app.listen.mockImplementation(async signal => {
            entered.resolve();
            await pending.promise;
            expect(signal?.aborted).toBe(true);
        });
        const adapter = new TestAdapter(app);
        app.adapters.set("mock", adapter);
        const result = expect(app.start()).rejects.toMatchObject({ name: "AbortError" });
        await entered.promise;
        await app.stop();
        pending.resolve();
        await result;
        expect(adapter.startTask).not.toHaveBeenCalled();
    });

    it("keeps start pending until account startup completes and rolls back failures once", async () => {
        const app = createApp();
        const pending = deferred();
        const entered = deferred();
        const adapter = new TestAdapter(app);
        adapter.startTask.mockImplementation(() => {
            entered.resolve();
            return pending.promise;
        });
        app.adapters.set("mock", adapter);
        const starting = app.start();
        await entered.promise;
        expect(app.isStarted).toBe(false);
        pending.resolve();
        await starting;
        expect(app.isStarted).toBe(true);
        await app.stop();
        expect(adapter.stopTask).toHaveBeenCalledOnce();
    });

    it("shares failed stop results without rerunning cleanup after startup failure", async () => {
        const app = createApp();
        const stopHook = vi.fn(() => {
            throw new Error("停止失败");
        });
        app.lifecycle.addHook({
            onStart: () => {
                throw new Error("启动失败");
            },
            onStop: stopHook,
        });
        await expect(app.start()).rejects.toThrow("回滚未完整完成");
        const stopping = app.stop();
        expect(app.stop()).toBe(stopping);
        await expect(stopping).rejects.toThrow("停止失败");
        expect(stopHook).toHaveBeenCalledOnce();
        expect(app.isDisposed).toBe(true);
    });
});
