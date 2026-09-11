import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateSystemService, inspectServiceMigration } from "./service-migration-coordinator.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { inspectServiceMigrationRecovery } from "./service-recovery-inspection.js";
import type { RetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import type { ServiceMigrationBackup, ServiceMigrationPort } from "./service-migration-types.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
    const root = fs.mkdtempSync("/tmp/ob-migration-coordinator-");
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const stateDirectory = path.join(root, "service");
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        previousRunning: false,
        previousEnabled: true,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace,
            workingDirectory: workspace,
            nodePath: process.execPath,
            binPath: "/app/bin.js",
            host: "127.0.0.1",
            port: 6727,
        },
        files: (["definition", "metadata", "configuration"] as const).map(role => ({
            role,
            path: path.join(root, role),
            mode: 0o600,
            contentBase64: Buffer.from("test").toString("base64"),
        })),
    };
    const port: ServiceMigrationPort = {
        verifyOriginal: async () => true,
        stopOriginal: async () => {},
        verifyQuiescent: async () => true,
        writeTarget: async () => {},
        startTarget: async () => {},
        verifyTarget: async () => true,
        releaseTarget: async () => undefined,
        stopTarget: async () => {},
        canRestore: async () => true,
        restoreOriginal: async () => {},
        startOriginal: async () => {},
        verifyRestored: async () => true,
    };
    return { workspace, stateDirectory, backup, port };
}
describe("服务迁移协调器", () => {
    it("先记录捕获意图，失败后保留原操作且不构造或调用系统端口", async () => {
        const t = fixture();
        const port = vi.fn(() => t.port);
        const retain = vi.fn(async () => {
            const record = JSON.parse(
                fs.readFileSync(
                    path.join(t.stateDirectory, "migrations", "capture-failure.journal.json"),
                    "utf8",
                ),
            );
            expect(record.phase).toBe("capturing-runtime");
            throw new Error("private capture failure");
        });
        const result = await migrateSystemService({
            ...t,
            id: "capture-failure",
            capture: async () => t.backup,
            retain,
            port,
        });
        expect(result).toMatchObject({
            phase: "capturing-runtime",
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(port).not.toHaveBeenCalled();
        await expect(
            migrateSystemService({
                ...t,
                id: "another",
                capture: async () => t.backup,
                retain,
                port,
            }),
        ).rejects.toThrow();
        expect(retain).toHaveBeenCalledTimes(1);
    });
    it("绑定工件后端口消费新的备份摘要，原始备份保持可追溯", async () => {
        const t = fixture();
        const original = {
            scope: "user" as const,
            configPath: "/data/config.yaml",
            nodePath: "/usr/bin/node",
            binPath: "/old/bin.js",
            workingDirectory: "/old",
            adapters: [],
            protocols: [],
        };
        const tree = (root: string) => ({
            schemaVersion: 1 as const,
            id: "10000000-0000-4000-8000-000000000001",
            root,
            digest: "a".repeat(64),
        });
        const retained: RetainedLegacyRuntime = {
            schemaVersion: 1,
            sourceRoot: "/old",
            original,
            runtime: tree("/artifacts/program/runtime"),
            node: {
                schemaVersion: 1,
                tree: tree("/artifacts/node/runtime"),
                version: "v24.0.0",
                platform: "linux",
                arch: "x64",
            },
            rollback: {
                ...original,
                nodePath: "/artifacts/node/runtime/node",
                binPath: "/artifacts/program/runtime/bin.js",
                workingDirectory: "/artifacts/program/runtime",
            },
        };
        let originalDigest = "";
        t.backup.files.find(file => file.role === "metadata")!.contentBase64 = Buffer.from(
            JSON.stringify(original),
        ).toString("base64");
        const result = await migrateSystemService({
            ...t,
            id: "retained",
            capture: async () => t.backup,
            retain: async () => {
                const record = JSON.parse(
                    fs.readFileSync(
                        path.join(t.stateDirectory, "migrations", "retained.journal.json"),
                        "utf8",
                    ),
                );
                expect(record.phase).toBe("capturing-runtime");
                originalDigest = record.backupDigest;
                return retained;
            },
            port: backup => {
                expect(backup.retainedRuntime).toEqual(retained);
                return t.port;
            },
        });
        expect(result.status).toBe("succeeded");
        expect(result.backupDigest).not.toBe(originalDigest);
        expect(result.previousBackupDigests).toEqual([originalDigest]);
        const canonicalState = fs.realpathSync(t.stateDirectory);
        expect(inspectServiceMigrationRecovery(canonicalState)).toBe(false);
        const stray = path.join(canonicalState, "migrations", `${"b".repeat(64)}.backup.json`);
        fs.writeFileSync(stray, "{}", { mode: 0o400 });
        expect(inspectServiceMigrationRecovery(canonicalState)).toBe(true);
        const historical = JSON.parse(
            fs.readFileSync(
                path.join(t.stateDirectory, "migrations", `${originalDigest}.backup.json`),
                "utf8",
            ),
        );
        expect(historical).toEqual(t.backup);
        expect(historical.retainedRuntime).toBeUndefined();
    });
    it("捕获期间已持服务锁，另一个入口不能进入，但目标工作区锁仍可取得", async () => {
        const t = fixture();
        let finish!: () => void;
        let captured!: () => void;
        const entered = new Promise<void>(resolve => {
            captured = resolve;
        });
        const gate = new Promise<void>(resolve => {
            finish = resolve;
        });
        const running = migrateSystemService({
            ...t,
            id: "first",
            capture: async () => {
                captured();
                await gate;
                return t.backup;
            },
        });
        await entered;
        try {
            const capture = vi.fn(async () => t.backup);
            await expect(migrateSystemService({ ...t, id: "second", capture })).rejects.toThrow();
            expect(capture).not.toHaveBeenCalled();
            const releaseWorkspace = acquireControlWorkspace(t.workspace);
            releaseWorkspace();
            expect(() => inspectServiceMigration(t.stateDirectory, "first")).toThrow();
        } finally {
            finish();
        }
        expect(await running).toMatchObject({ status: "succeeded" });
        expect(inspectServiceMigration(t.stateDirectory, "first").status).toBe("succeeded");
    });
    it("只读捕获失败释放服务锁，不生成可重放操作", async () => {
        const t = fixture();
        await expect(
            migrateSystemService({
                ...t,
                id: "failed",
                capture: async () => {
                    throw new Error("read failed");
                },
            }),
        ).rejects.toThrow("read failed");
        expect(
            await migrateSystemService({ ...t, id: "next", capture: async () => t.backup }),
        ).toMatchObject({ status: "succeeded" });
    });
});
