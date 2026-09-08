import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationApplication } from "./configuration-application.js";
import type { ConfigurationTransactionPort } from "../control/generation-activation.js";

const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(desired: "running" | "stopped" = "running") {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-apply-"));
    directories.push(directory);
    const events: string[] = [];
    let snapshot = { revision: hash("old"), document: { token: "old-synthetic-secret" } };
    const state = {
        live: desired === "running",
        failStart: false,
        leak: false,
        failRestore: false,
        generation: null as string | null,
        unknown: false,
        drift: false,
    };
    const source = {
        read: () => structuredClone(snapshot),
        replace: vi.fn((expected: string, document: Record<string, unknown>) => {
            if (expected !== snapshot.revision) throw new Error("synthetic-secret conflict");
            events.push(document.token === "new-synthetic-secret" ? "write:new" : "write:old");
            snapshot = {
                revision: hash(document),
                document: structuredClone(document) as typeof snapshot.document,
            };
            return structuredClone(snapshot);
        }),
    };
    const port: ConfigurationTransactionPort = {
        activeGenerationId: () => state.generation,
        gatewayStatus: () => ({ desired, recoveryRequired: state.unknown }),
        hasLiveChildren: () => state.live,
        suspend: async () => {
            events.push("stop");
            state.live = false;
            return { status: "succeeded" };
        },
        start: async () => {
            events.push(
                snapshot.document.token === "new-synthetic-secret" ? "start:new" : "start:old",
            );
            if (
                (snapshot.document.token === "new-synthetic-secret" && state.failStart) ||
                (snapshot.document.token === "old-synthetic-secret" && state.failRestore)
            ) {
                state.live = state.leak;
                if (state.drift)
                    snapshot = { revision: hash("external"), document: { token: "external" } };
                return { status: "failed" };
            }
            state.live = true;
            return { status: "succeeded" };
        },
    };
    let tail = Promise.resolve<unknown>(undefined);
    const lifecycle = {
        runConfigurationTransaction<T>(
            action: (port: ConfigurationTransactionPort) => Promise<T>,
        ): Promise<T> {
            const next = tail.then(() => action(port));
            tail = next.catch(() => undefined);
            return next;
        },
    };
    const options = { directory, source, lifecycle };
    const application = new ConfigurationApplication(options);
    const request = {
        id: "request-1",
        validationId: "validation-1",
        base: { generationId: null, configRevision: snapshot.revision },
        document: { token: "new-synthetic-secret" },
    };
    return { application, request, options, source, state, events, directory };
}

describe("configuration application transaction", () => {
    it("先持久intent和私有文档再停机，成功后重放/冷重启不再产生副作用", async () => {
        const test = fixture();
        const original = test.options.lifecycle.runConfigurationTransaction.bind(
            test.options.lifecycle,
        );
        test.options.lifecycle.runConfigurationTransaction = action =>
            original(async port => {
                const suspend = port.suspend;
                return action({
                    ...port,
                    suspend: async () => {
                        const journal = JSON.parse(
                            fs.readFileSync(path.join(test.directory, "request-1.json"), "utf8"),
                        );
                        expect(journal.status).toBe("running");
                        expect(fs.readdirSync(path.join(test.directory, "documents"))).toHaveLength(
                            2,
                        );
                        expect(JSON.stringify(journal)).not.toContain("synthetic-secret");
                        return suspend();
                    },
                });
            });
        const result = await test.application.apply(test.request);
        expect(result.status).toBe("succeeded");
        expect(test.events).toEqual(["stop", "write:new", "start:new"]);
        expect(await test.application.apply(test.request)).toEqual(result);
        expect(await new ConfigurationApplication(test.options).apply(test.request)).toEqual(
            result,
        );
        expect(test.events).toHaveLength(3);
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
        expect(result).not.toHaveProperty("documentDigest");
    });
    it("保持用户stopped意图，安装配置不自动启动", async () => {
        const test = fixture("stopped");
        expect((await test.application.apply(test.request)).status).toBe("succeeded");
        expect(test.events).toEqual(["stop", "write:new"]);
    });
    it("并发请求在同一队列CAS，调用后输入变更不能修改提交快照", async () => {
        const test = fixture();
        const first = test.application.apply(test.request);
        const stale = test.application.apply({ ...test.request, id: "request-2" });
        test.request.document.token = "mutated-secret";
        expect((await first).status).toBe("succeeded");
        await expect(stale).rejects.toThrow("配置已发生变化");
        expect(test.source.read().document.token).toBe("new-synthetic-secret");
        await expect(test.application.apply(test.request)).rejects.toThrow("配置已发生变化");
    });
    it("generation发生变化，校验回执不能应用", async () => {
        const test = fixture();
        test.state.generation = "other";
        await expect(test.application.apply(test.request)).rejects.toThrow("配置已发生变化");
        expect(test.events).toEqual([]);
    });
    it("已确认新实例退出才能恢复原文档并启动旧配置", async () => {
        const test = fixture();
        test.state.failStart = true;
        expect(await test.application.apply(test.request)).toMatchObject({
            status: "failed",
            rolledBack: true,
            recoveryRequired: false,
        });
        expect(test.events).toEqual(["stop", "write:new", "start:new", "write:old", "start:old"]);
        expect(test.application.health().recoveryRequired).toBe(false);
    });
    it("新进程未退出/外部配置漂移/旧配置启动失败均封锁，不盲目覆盖重启", async () => {
        for (const kind of ["leak", "drift", "failRestore"] as const) {
            const test = fixture();
            test.state.failStart = true;
            test.state[kind] = true;
            expect(await test.application.apply(test.request)).toMatchObject({
                status: "failed",
                recoveryRequired: true,
                error: "CONFIG_RECOVERY_REQUIRED",
            });
            expect(test.application.health().recoveryRequired).toBe(true);
            if (kind !== "failRestore")
                expect(test.events).toEqual(["stop", "write:new", "start:new"]);
            await expect(
                test.application.apply({ ...test.request, id: "blocked" }),
            ).rejects.toThrow("人工对账");
        }
    });
    it("配置replace落盘后抛错视为结果未知，不能推断未写并启动旧实例", async () => {
        const test = fixture();
        const original = test.source.replace.getMockImplementation()!;
        test.source.replace.mockImplementation((revision, document) => {
            original(revision, document);
            throw new Error("synthetic-secret fsync");
        });
        const result = await test.application.apply(test.request);
        expect(result).toMatchObject({ recoveryRequired: true, error: "CONFIG_RECOVERY_REQUIRED" });
        expect(test.events).toEqual(["stop", "write:new"]);
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
        expect(new ConfigurationApplication(test.options).health().recoveryRequired).toBe(true);
    });
    it("初始intent写失败不执行停机；结果journal写失败封锁且冷恢复发现未完成意图", async () => {
        const test = fixture();
        const original = fs.renameSync;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (String(to).endsWith("request-1.json"))
                throw new Error("synthetic-secret write error");
            original(from, to);
        });
        await expect(test.application.apply(test.request)).rejects.toThrow("意图无法持久化");
        expect(test.events).toEqual([]);
        vi.restoreAllMocks();
        const completed = fixture();
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (String(to).endsWith("request-1.json") && completed.events.includes("start:new"))
                throw new Error("secret");
            original(from, to);
        });
        expect((await completed.application.apply(completed.request)).recoveryRequired).toBe(true);
        vi.restoreAllMocks();
        const reopened = new ConfigurationApplication(completed.options);
        expect(reopened.status("request-1")).toMatchObject({
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(reopened.health().recoveryRequired).toBe(true);
    });
    it("损坏私有文档阻止重放且目录权限私有", async () => {
        const test = fixture();
        await test.application.apply(test.request);
        const journal = JSON.parse(
            fs.readFileSync(path.join(test.directory, "request-1.json"), "utf8"),
        );
        const file = path.join(test.directory, "documents", `${journal.documentDigest}.json`);
        if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        fs.writeFileSync(file, "synthetic-secret corrupted");
        const reopened = new ConfigurationApplication(test.options);
        expect(reopened.health().recoveryRequired).toBe(true);
        expect(() => reopened.status("request-1")).toThrow(/^配置应用记录或请求无效$/);
    });
});
