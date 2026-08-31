import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseApp } from "./base-app.js";

const originalConfigDir = BaseApp.configDir;
const temporaryDirectories: string[] = [];

function createApp(): BaseApp {
    const directory = mkdtempSync(join(tmpdir(), "onebots-startup-rollback-"));
    temporaryDirectories.push(directory);
    BaseApp.configDir = directory;
    return new BaseApp({ database: "startup.db" });
}

afterEach(() => {
    BaseApp.configDir = originalConfigDir;
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("BaseApp startup rollback", () => {
    it("启动钩子失败时释放所有资源并禁止复用实例", async () => {
        const app = createApp();
        const onStop = vi.fn(async () => undefined);
        const onCleanup = vi.fn(async () => undefined);
        const onClose = vi.fn(async () => undefined);
        app.lifecycle.addHook({
            onStart: async () => {
                throw new Error("startup failed");
            },
            onStop,
            onCleanup,
        });
        app.once("close", onClose);

        await expect(app.start()).rejects.toThrow("startup failed");

        expect(onStop).toHaveBeenCalledOnce();
        expect(onCleanup).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(app.lifecycle.getResourceCount()).toBe(0);
        expect(app.httpServer.listening).toBe(false);
        expect(app.isStarted).toBe(false);
        expect(app.isDisposed).toBe(true);
        await expect(app.start()).rejects.toThrow("不能再次启动");
    });

    it("回滚失败时继续清理并同时保留两类错误", async () => {
        const app = createApp();
        const onCleanup = vi.fn(async () => undefined);
        const onClose = vi.fn(async () => undefined);
        app.lifecycle.addHook({
            onStart: async () => {
                throw new Error("startup failed");
            },
            onStop: async () => {
                throw new Error("rollback failed");
            },
            onCleanup,
        });
        app.once("close", onClose);

        await expect(app.start()).rejects.toMatchObject({
            message: "应用启动失败且回滚未完整完成",
            cause: expect.objectContaining({
                errors: expect.arrayContaining([
                    expect.objectContaining({ message: "startup failed" }),
                    expect.objectContaining({ message: "rollback failed" }),
                ]),
            }),
        });

        expect(onCleanup).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(app.lifecycle.getResourceCount()).toBe(0);
        expect(app.isDisposed).toBe(true);
    });
});
