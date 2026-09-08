import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { ServiceMigrationTransaction } from "./service-migration-transaction.js";
import type {
    ServiceMigrationBackup,
    ServiceMigrationPort,
    ServiceMigrationPhase,
} from "./service-migration-types.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});
function fixture(previousRunning = true) {
    const root = fs.mkdtempSync("/tmp/ob-service-transaction-");
    roots.push(root);
    const journal = new FileServiceMigrationJournal(root);
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        previousRunning,
        previousEnabled: true,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: "/data",
            nodePath: process.execPath,
            binPath: "/app/bin.js",
            workingDirectory: "/data",
            host: "127.0.0.1",
            port: 6727,
        },
        files: ["definition", "metadata", "configuration"].map(role => ({
            role: role as "definition" | "metadata" | "configuration",
            path: `/data/${role}`,
            mode: 0o600,
            contentBase64: Buffer.from("原始秘密\r\n").toString("base64"),
        })),
    };
    const calls: string[] = [];
    const state = {
        targetValid: true,
        quiescent: true,
        restoreAllowed: true,
        stopTargetFails: false,
        stopOldFails: false,
    };
    const act = (name: string, phase: ServiceMigrationPhase) => {
        expect(journal.read("migration").phase).toBe(phase);
        calls.push(name);
    };
    const port: ServiceMigrationPort = {
        verifyOriginal: async () => true,
        stopOriginal: async () => {
            act("stop-old", "stopping-old");
            if (state.stopOldFails) throw new Error("unknown");
        },
        verifyQuiescent: async () => state.quiescent,
        writeTarget: async () => act("write-target", "writing-target"),
        startTarget: async () => act("start-target", "starting-manager"),
        verifyTarget: async () => state.targetValid,
        stopTarget: async () => {
            act("stop-target", "stopping-target");
            if (state.stopTargetFails) throw new Error("unknown");
        },
        canRestore: async () => state.restoreAllowed,
        restoreOriginal: async () => act("restore", "restoring"),
        startOriginal: async () => act("start-old", "restarting-old"),
        verifyRestored: async () => true,
    };
    return {
        root,
        journal,
        backup,
        calls,
        state,
        transaction: new ServiceMigrationTransaction(journal, port),
        port,
    };
}
describe("持久化服务迁移事务", () => {
    it.each([true, false])("原运行状态%s按意图切换，每个外部效果之前已有日志", async running => {
        const t = fixture(running);
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            status: "succeeded",
            recoveryRequired: false,
            rolledBack: false,
        });
        expect(t.calls).toEqual(
            running ? ["stop-old", "write-target", "start-target"] : ["stop-old", "write-target"],
        );
        expect(JSON.stringify(result)).not.toContain("原始秘密");
        await expect(t.transaction.run("migration", t.backup)).rejects.toThrow();
    });
    it.each([true, false])(
        "新定义未验收时停止新实例后回退，原运行%s才重启旧服务",
        async running => {
            const t = fixture(running);
            t.state.targetValid = false;
            expect(await t.transaction.run("migration", t.backup)).toMatchObject({
                status: "failed",
                rolledBack: true,
                recoveryRequired: false,
            });
            expect(t.calls).toEqual(
                running
                    ? [
                          "stop-old",
                          "write-target",
                          "start-target",
                          "stop-target",
                          "restore",
                          "start-old",
                      ]
                    : ["stop-old", "write-target", "stop-target", "restore"],
            );
        },
    );
    it("无法确认新实例停止时不恢复文件、不启动旧服务", async () => {
        const t = fixture();
        t.state.targetValid = false;
        t.state.stopTargetFails = true;
        expect(await t.transaction.run("migration", t.backup)).toMatchObject({
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(t.calls).not.toContain("restore");
        await expect(t.transaction.run("another", t.backup)).rejects.toThrow();
    });
    it("写目标前日志失败不执行写入或额外补偿", async () => {
        const t = fixture();
        const save = t.journal.save.bind(t.journal);
        vi.spyOn(t.journal, "save").mockImplementation(record => {
            if (record.phase === "writing-target") throw new Error("disk");
            save(record);
        });
        expect(await t.transaction.run("migration", t.backup)).toMatchObject({
            recoveryRequired: true,
        });
        expect(t.calls).toEqual(["stop-old"]);
    });
    it("旧服务未确认退出绝不启动另一轨", async () => {
        const t = fixture();
        t.state.stopOldFails = true;
        t.state.quiescent = false;
        expect(await t.transaction.run("migration", t.backup)).toMatchObject({
            recoveryRequired: true,
        });
        expect(t.calls).toEqual(["stop-old"]);
    });
    it("第三方改动不被回退覆盖", async () => {
        const t = fixture();
        t.state.targetValid = false;
        t.state.restoreAllowed = false;
        expect(await t.transaction.run("migration", t.backup)).toMatchObject({
            recoveryRequired: true,
        });
        expect(t.calls).not.toContain("restore");
    });
});
