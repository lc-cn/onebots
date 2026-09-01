import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BaseApp, getTokenManager, initTokenManager } from "@onebots/core";
import { App } from "./app.js";

const originalConfigDir = BaseApp.configDir;
const originalWorkingDirectory = process.cwd();
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
const temporaryDirectories: string[] = [];

afterEach(() => {
    process.chdir(originalWorkingDirectory);
    BaseApp.configDir = originalConfigDir;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("App startup rollback", () => {
    it("使用实例级会话管理器且不改写兼容的全局管理器", async () => {
        const directory = mkdtempSync(join(tmpdir(), "onebots-app-token-manager-"));
        const workingDirectory = mkdtempSync(join(tmpdir(), "onebots-app-token-working-"));
        temporaryDirectories.push(directory, workingDirectory);
        process.chdir(workingDirectory);
        BaseApp.configDir = directory;
        const globalManager = initTokenManager();
        const app = new App({});

        try {
            expect(app.tokenManager).not.toBe(globalManager);
            expect(getTokenManager()).toBe(globalManager);
            const session = app.tokenManager.generateToken();
            expect(globalManager.validateToken(session.token).valid).toBe(false);
        } finally {
            await app.stop();
        }
    });

    it("启动前配置校验失败时释放进程级资源", async () => {
        const directory = mkdtempSync(join(tmpdir(), "onebots-app-startup-rollback-"));
        const workingDirectory = mkdtempSync(join(tmpdir(), "onebots-app-working-directory-"));
        temporaryDirectories.push(directory, workingDirectory);
        process.chdir(workingDirectory);
        BaseApp.configDir = directory;
        const exitListenerCount = process.listenerCount("exit");
        const app = new App({
            general: {
                "ghost.v1": { use_http: true },
            },
        });

        expect(process.listenerCount("exit")).toBe(exitListenerCount + 1);
        expect(app.logCacheFile).toBe(join(directory, "data", "terminal-logs.txt"));
        expect(existsSync(join(workingDirectory, "data", "terminal-logs.txt"))).toBe(false);
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
