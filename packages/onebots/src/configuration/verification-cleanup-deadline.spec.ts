import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { inspectConfigurationRuntime } from "./configuration-runtime-inspect.js";
import { verifyConfiguration } from "./configuration-verify.js";
import { verifyGeneration } from "../installation/generation-verify.js";
import { createGenerationPlan } from "../installation/generation-plan.js";
vi.mock("node:child_process", async original => ({
    ...(await original<typeof import("node:child_process")>()),
    fork: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
function fixture(kind: "configuration" | "generation" | "inspection") {
    vi.useFakeTimers();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-verification-deadline-"));
    roots.push(root);
    const privateRoot = path.join(root, "owned");
    const worker = Object.assign(new EventEmitter(), {
        pid: 1234567,
        connected: true,
        channel: { unref: vi.fn() },
        unref: vi.fn(),
        send: vi.fn((_value: unknown, callback?: (error: Error | null) => void) =>
            callback?.(null),
        ),
        disconnect: vi.fn(() => {
            worker.connected = false;
        }),
    });
    vi.mocked(fork).mockReturnValue(worker as unknown as ChildProcess);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("denied"), { code: "EPERM" });
    });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const run = () =>
        kind === "configuration"
            ? verifyConfiguration({
                  runtimeRoot: root,
                  privateRoot,
                  document: { general: {} },
                  selection: { adapters: [], protocols: [], applications: [] },
                  timeoutMs: 100,
                  signal: controller.signal,
              })
            : kind === "inspection"
              ? inspectConfigurationRuntime({
                    runtimeRoot: root,
                    privateRoot,
                    selection: { adapters: [], protocols: [], applications: [] },
                    timeoutMs: 100,
                    signal: controller.signal,
                })
              : verifyGeneration(
                    root,
                    createGenerationPlan({
                        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
                        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
                        extensions: [],
                        selection: { adapters: [], protocols: [], applications: [] },
                    }),
                    { privateRoot, timeoutMs: 100, signal: controller.signal },
                );
    return { root, privateRoot, worker, kill, controller, remove, run };
}
it.each(["configuration", "generation", "inspection"] as const)(
    "%s: timeout+EPERM且无close仍有界拒绝并保留owner",
    async kind => {
        const f = fixture(kind);
        const pending = f.run();
        let completed = false;
        void pending.then(
            () => {
                completed = true;
            },
            () => {
                completed = true;
            },
        );
        const rejected =
            kind === "configuration"
                ? expect(pending).rejects.toMatchObject({ code: "CLEANUP_FAILED" })
                : expect(pending).rejects.toThrow(
                      kind === "inspection" ? "运行环境配置能力探测未完成" : "无法确认退出",
                  );
        await vi.advanceTimersByTimeAsync(100);
        expect(f.kill).toHaveBeenCalledWith(-f.worker.pid, "SIGKILL");
        expect(completed).toBe(false);
        await vi.advanceTimersByTimeAsync(1999);
        expect(completed).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(f.worker.disconnect).toHaveBeenCalledOnce();
        expect(f.worker.unref).toHaveBeenCalledOnce();
        expect(f.worker.channel.unref).toHaveBeenCalledOnce();
        expect(f.remove).toHaveBeenCalledWith("abort", expect.any(Function));
        const owned = fs.readdirSync(f.privateRoot);
        expect(owned).toHaveLength(1);
        const ownerFile = path.join(f.privateRoot, owned[0], "owner.json");
        const before = fs.readFileSync(ownerFile, "utf8");
        expect(JSON.parse(before)).toMatchObject({ phase: "running", workerPid: f.worker.pid });
        // 晚到成功信息和 close 都不能将 cleanupAllowed 改回true并删掉恢复证据。
        f.worker.emit(
            "message",
            kind === "configuration"
                ? { valid: true, issues: [] }
                : {
                      fingerprint: "a".repeat(64),
                      schemas: JSON.stringify({
                          schemaVersion: 1,
                          adapters: {},
                          protocols: {},
                          applications: {},
                          runtimeOnly: [],
                          protocolMetadata: [],
                      }),
                  },
        );
        f.kill.mockImplementation(() => {
            throw Object.assign(new Error("gone"), { code: "ESRCH" });
        });
        f.worker.emit("close", 0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fs.readFileSync(ownerFile, "utf8")).toBe(before);
        expect(fs.existsSync(path.join(f.root, "schemas.json"))).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    },
);
it.each(["configuration", "generation", "inspection"] as const)(
    "%s:取消也启动独立有界收尾，不等主timeout",
    async kind => {
        const f = fixture(kind);
        const pending = f.run();
        const rejected = expect(pending).rejects.toThrow();
        f.controller.abort();
        await vi.advanceTimersByTimeAsync(2000);
        await rejected;
        expect(fs.readdirSync(f.privateRoot)).toHaveLength(1);
        expect(f.worker.unref).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    },
);
it.each(["configuration", "generation", "inspection"] as const)(
    "%s:正常close且组退出仍可成功并清理私有目录",
    async kind => {
        const f = fixture(kind);
        const pending = f.run();
        f.worker.emit(
            "message",
            kind === "configuration"
                ? { valid: true, issues: [] }
                : {
                      fingerprint: "a".repeat(64),
                      schemas: JSON.stringify({
                          schemaVersion: 1,
                          adapters: {},
                          protocols: {},
                          applications: {},
                          runtimeOnly: [],
                          protocolMetadata: [],
                      }),
                  },
        );
        f.kill.mockImplementation(() => {
            throw Object.assign(new Error("gone"), { code: "ESRCH" });
        });
        f.worker.emit("close", 0);
        await pending;
        expect(fs.readdirSync(f.privateRoot)).toEqual([]);
        expect(f.worker.unref).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    },
);
