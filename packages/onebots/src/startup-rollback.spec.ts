import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BaseApp } from "@onebots/core";
import { App } from "./app.js";

const originalConfigDir = BaseApp.configDir;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
const temporaryDirectories: string[] = [];

afterEach(() => {
    BaseApp.configDir = originalConfigDir;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("App startup rollback", () => {
    it("启动前配置校验失败时释放进程级资源", async () => {
        const directory = mkdtempSync(join(tmpdir(), "onebots-app-startup-rollback-"));
        temporaryDirectories.push(directory);
        BaseApp.configDir = directory;
        const exitListenerCount = process.listenerCount("exit");
        const app = new App({
            general: {
                "ghost.v1": { use_http: true },
            },
        });

        expect(process.listenerCount("exit")).toBe(exitListenerCount + 1);
        expect(process.stdout.write).not.toBe(originalStdoutWrite);
        expect(process.stderr.write).not.toBe(originalStderrWrite);

        await expect(app.start()).rejects.toThrow("协议 ghost.v1 未加载");

        expect(app.isDisposed).toBe(true);
        expect(app.lifecycle.getResourceCount()).toBe(0);
        expect(process.listenerCount("exit")).toBe(exitListenerCount);
        expect(process.stdout.write).toBe(originalStdoutWrite);
        expect(process.stderr.write).toBe(originalStderrWrite);
    });
});
