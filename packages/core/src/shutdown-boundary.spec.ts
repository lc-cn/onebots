import { describe, expect, it, vi } from "vitest";
import { Adapter } from "./adapter.js";
import { BaseApp } from "./base-app.js";

describe("core shutdown boundary", () => {
    it("attempts every account in an adapter before propagating a stop failure", async () => {
        const firstStop = vi.fn(async () => {
            throw new Error("first account failed");
        });
        const secondStop = vi.fn(async () => undefined);
        const adapter = Object.create(Adapter.prototype) as Adapter;
        adapter.accounts = new Map([
            ["first", { account_id: "first", stop: firstStop }],
            ["second", { account_id: "second", stop: secondStop }],
        ]) as never;

        await expect(adapter.stop()).rejects.toThrow("first account failed");
        expect(firstStop).toHaveBeenCalledOnce();
        expect(secondStop).toHaveBeenCalledOnce();
    });

    it("releases lifecycle resources and emits close after extension stop failures", async () => {
        const lifecycleStop = vi.fn(async () => {
            throw new Error("lifecycle stop failed");
        });
        const cleanup = vi.fn(async () => undefined);
        const firstAdapterStop = vi.fn(async () => {
            throw new Error("adapter stop failed");
        });
        const secondAdapterStop = vi.fn(async () => undefined);
        const stopTimer = vi.fn();
        const app = Object.create(BaseApp.prototype) as BaseApp;
        Object.assign(app, {
            isStarted: true,
            isDisposed: false,
            lifecycle: { stop: lifecycleStop, cleanup },
            adapters: new Map([
                ["first", { stop: firstAdapterStop }],
                ["second", { stop: secondAdapterStop }],
            ]),
            enhancedLogger: {
                start: vi.fn(() => stopTimer),
                error: vi.fn(),
                info: vi.fn(),
            },
        });
        const close = vi.fn();
        app.on("close", close);

        await expect(app.stop()).rejects.toThrow(/2 个应用停止操作失败/);
        expect(lifecycleStop).toHaveBeenCalledOnce();
        expect(firstAdapterStop).toHaveBeenCalledOnce();
        expect(secondAdapterStop).toHaveBeenCalledOnce();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(app.adapters.size).toBe(0);
        expect(app.isStarted).toBe(false);
        expect(app.isDisposed).toBe(true);
        expect(stopTimer).toHaveBeenCalledOnce();
    });
});
