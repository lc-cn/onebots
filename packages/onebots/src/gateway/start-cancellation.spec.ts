import fs from "node:fs";
import { expect, it, vi } from "vitest";
import { BaseApp } from "@onebots/core";
import { GatewayApp } from "./app.js";

it("真实网关在启动钩子等待期间停止，迟到结果不能重新打开 HTTP", async () => {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-gateway-cancel-"));
    const previous = BaseApp.configDir;
    BaseApp.configDir = root;
    const app = new GatewayApp({ log_level: "off", general: {} });
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    const entry = new Promise<void>(resolve => {
        entered = resolve;
    });
    const nextHook = vi.fn();
    const listening = vi.fn();
    app.httpServer.on("listening", listening);
    app.lifecycle.addHook({
        onStart: async () => {
            entered();
            await pending;
        },
    });
    app.lifecycle.addHook({ onStart: nextHook });
    try {
        const started = app.start();
        const rejected = expect(started).rejects.toThrow();
        await entry;
        await app.stop();
        release();
        await rejected;
        expect(nextHook).not.toHaveBeenCalled();
        expect(listening).not.toHaveBeenCalled();
        expect(app.httpServer.address()).toBeNull();
        expect(app.isStarted).toBe(false);
        expect(app.isDisposed).toBe(true);
        await expect(app.start()).rejects.toThrow();
    } finally {
        release();
        await app.stop();
        BaseApp.configDir = previous;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
