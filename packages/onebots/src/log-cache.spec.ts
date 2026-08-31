import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogCacheManager } from "./log-cache.js";

const temporaryDirectories: string[] = [];

function createManager(): LogCacheManager {
    const directory = mkdtempSync(join(tmpdir(), "onebots-log-cache-"));
    temporaryDirectories.push(directory);
    return new LogCacheManager(join(directory, "terminal.log"));
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("LogCacheManager cleanup", () => {
    it("flushes the stream before truncating and closes every SSE client", async () => {
        const manager = createManager();
        const dispose = vi.fn();
        const end = vi.fn();
        const client = { end } as unknown as ServerResponse;
        manager.registerClient(client, dispose);
        manager.cache("pending log line");

        await manager.cleanup();
        await manager.cleanup();

        expect(readFileSync(manager.cacheFile, "utf8")).toBe("");
        expect(dispose).toHaveBeenCalledOnce();
        expect(end).toHaveBeenCalledOnce();
        expect(manager.clients.size).toBe(0);
        expect(() => manager.cache("late log line")).not.toThrow();
    });

    it("restores intercepted process streams before asynchronous cleanup completes", async () => {
        const manager = createManager();
        const stdoutWrite = process.stdout.write;
        const stderrWrite = process.stderr.write;
        manager.interceptStdio();

        expect(process.stdout.write).not.toBe(stdoutWrite);
        expect(process.stderr.write).not.toBe(stderrWrite);

        const cleanup = manager.cleanup();
        expect(process.stdout.write).toBe(stdoutWrite);
        expect(process.stderr.write).toBe(stderrWrite);
        await cleanup;
    });

    it("continues closing clients and the stream before aggregating cleanup failures", async () => {
        const manager = createManager();
        const healthyDispose = vi.fn();
        const healthyEnd = vi.fn();
        manager.registerClient(
            {
                end: () => {
                    throw new Error("response close failed");
                },
            } as unknown as ServerResponse,
            () => {
                throw new Error("heartbeat cleanup failed");
            },
        );
        manager.registerClient({ end: healthyEnd } as unknown as ServerResponse, healthyDispose);
        manager.cache("pending log line");

        await expect(manager.cleanup()).rejects.toThrow("2 个日志缓存清理操作失败");

        expect(healthyDispose).toHaveBeenCalledOnce();
        expect(healthyEnd).toHaveBeenCalledOnce();
        expect(readFileSync(manager.cacheFile, "utf8")).toBe("");
        expect(manager.clients.size).toBe(0);
    });
});
