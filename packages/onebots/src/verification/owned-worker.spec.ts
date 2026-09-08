import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { allocateConfigurationVerification } from "../configuration/configuration-verify-ownership.js";
import { runOwnedWorker } from "./owned-worker.js";
vi.mock("node:child_process", async original => ({
    ...(await original<typeof import("node:child_process")>()),
    fork: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-owned-worker-"));
    roots.push(root);
    const allocation = allocateConfigurationVerification(path.join(root, "private"));
    const readOwner = () =>
        JSON.parse(fs.readFileSync(path.join(allocation.directory, "owner.json"), "utf8"));
    const worker = Object.assign(new EventEmitter(), {
        pid: 1234567,
        send: vi.fn(() => {
            expect(readOwner()).toMatchObject({ phase: "running", workerPid: 1234567 });
        }),
    });
    vi.mocked(fork).mockImplementation(() => {
        expect(readOwner()).toMatchObject({ phase: "spawning", workerPid: null });
        return worker as unknown as ChildProcess;
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error(), { code: "ESRCH" });
    });
    const lifecycle = { cleanupAllowed: true };
    const run = (decode: (value: unknown) => unknown) =>
        runOwnedWorker({
            entrypoint: "/trusted/worker.js",
            args: ["private-request"],
            cwd: root,
            directory: allocation.directory,
            owner: allocation.owner,
            request: { kind: "verify" },
            timeoutMs: 1000,
            lifecycle,
            decode,
        });
    return { worker, lifecycle, run, directory: allocation.directory };
}
it("先持久化所有权再派发，环境不继承凭据或Node注入，undefined结果有效", async () => {
    const f = fixture();
    vi.stubEnv("NODE_OPTIONS", "--require=untrusted");
    vi.stubEnv("NPM_TOKEN", "secret");
    vi.stubEnv("ONEBOTS_AUTH_BOOTSTRAP_CODE", "secret");
    const pending = f.run(() => undefined);
    expect(fork).toHaveBeenCalledWith(
        "/trusted/worker.js",
        ["private-request"],
        expect.objectContaining({
            detached: true,
            execArgv: [],
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            env: expect.objectContaining({ HOME: f.directory, NODE_ENV: "production" }),
        }),
    );
    const env = vi.mocked(fork).mock.calls[0][2]?.env;
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    expect(env).not.toHaveProperty("NPM_TOKEN");
    expect(env).not.toHaveProperty("ONEBOTS_AUTH_BOOTSTRAP_CODE");
    expect(f.lifecycle.cleanupAllowed).toBe(false);
    f.worker.emit("message", {});
    f.worker.emit("close", 0);
    await expect(pending).resolves.toBeUndefined();
    expect(f.lifecycle.cleanupAllowed).toBe(true);
});
it.each(["duplicate", "decode"])("%s失败映射WORKER_FAILED，只有组退出后才能清理", async mode => {
    const f = fixture();
    const pending = f.run(() => {
        if (mode === "decode") throw new Error("private-data");
        return true;
    });
    const rejected = expect(pending).rejects.toMatchObject({
        code: "WORKER_FAILED",
        message: "隔离验证进程未完成",
    });
    f.worker.emit("message", {});
    if (mode === "duplicate") f.worker.emit("message", {});
    expect(f.lifecycle.cleanupAllowed).toBe(false);
    f.worker.emit("close", 0);
    await rejected;
    expect(f.lifecycle.cleanupAllowed).toBe(true);
});
