import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateSystemService, inspectServiceMigration } from "./service-migration-coordinator.js";
import { acquireControlWorkspace } from "./control/workspace.js";
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
