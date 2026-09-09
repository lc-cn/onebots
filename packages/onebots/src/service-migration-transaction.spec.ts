import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { ServiceMigrationTransaction } from "./service-migration-transaction.js";
import { digestServiceMigrationReloadOldReceipt } from "./service-migration-retained-runtime.js";
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
        writeTargetFails: false,
        reloadOldFails: false,
        startOldFails: false,
        releaseFails: false,
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
        writeTarget: async () => {
            act("write-target", "writing-target");
            if (state.writeTargetFails) throw new Error("unknown");
        },
        startTarget: async () => act("start-target", "starting-manager"),
        verifyTarget: async () => state.targetValid,
        releaseTarget: async () => {
            act("release-target", "releasing-target");
            if (state.releaseFails) throw new Error("unknown");
        },
        stopTarget: async () => {
            act("stop-target", "stopping-target");
            if (state.stopTargetFails) throw new Error("unknown");
        },
        canRestore: async () => state.restoreAllowed,
        restoreOriginal: async () => act("restore", "restoring"),
        reloadOriginal: async (_backup, backupDigest) => {
            act("reload-old", "reloading-old");
            if (state.reloadOldFails) throw new Error("unknown");
            return {
                schemaVersion: 1,
                backupDigest,
                rollbackContractDigest: "b".repeat(64),
                enabled: backup.previousEnabled,
                loaded: true,
                definitionPath: "/data/definition",
            };
        },
        startOriginal: async (_backup, reloadReceipt) => {
            act("start-old", "starting-old");
            if (state.startOldFails) throw new Error("unknown");
            if (!reloadReceipt) throw new Error("missing receipt");
            return {
                schemaVersion: 1,
                reloadReceiptDigest: digestServiceMigrationReloadOldReceipt(reloadReceipt),
                processId: 42,
                identity: "stable-old-instance",
            };
        },
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
    it("冷启动后的prepared记录不能作为热捕获结果重放", async () => {
        const t = fixture();
        const record = t.journal.prepare("migration", t.backup);
        const reopened = new FileServiceMigrationJournal(t.root);
        await expect(
            new ServiceMigrationTransaction(reopened, t.port).runPrepared(record),
        ).rejects.toThrow("禁止重放");
        expect(t.calls).toEqual([]);
        expect(reopened.read("migration")).toMatchObject({
            status: "interrupted",
            recoveryRequired: true,
        });
    });
    it("释放意图落盘失败不开放管理操作，也不回退已验收的目标", async () => {
        const t = fixture();
        const transition = t.journal.transition.bind(t.journal);
        vi.spyOn(t.journal, "transition").mockImplementation((record, command) => {
            if (record.phase === "verifying" && command.type === "advance-target")
                throw new Error("private disk failure");
            return transition(record, command);
        });
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            phase: "verifying",
            status: "interrupted",
            recoveryRequired: true,
            rolledBack: false,
        });
        expect(t.calls).toEqual(["stop-old", "write-target", "start-target"]);
        expect(t.journal.read("migration")).toEqual(result);
        expect(JSON.stringify(result)).not.toContain("private disk failure");
        await expect(t.transaction.run("another", t.backup)).rejects.toThrow();
        expect(t.calls).toEqual(["stop-old", "write-target", "start-target"]);
    });
    it("释放成功但completed落盘失败只标未知，不停止目标或恢复旧服务", async () => {
        const t = fixture();
        const transition = t.journal.transition.bind(t.journal);
        vi.spyOn(t.journal, "transition").mockImplementation((record, command) => {
            if (command.type === "complete-success") throw new Error("private disk failure");
            return transition(record, command);
        });
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            phase: "releasing-target",
            status: "interrupted",
            recoveryRequired: true,
            rolledBack: false,
        });
        expect(t.calls).toEqual(["stop-old", "write-target", "start-target", "release-target"]);
        expect(t.journal.read("migration")).toEqual(result);
        await expect(t.transaction.run("another", t.backup)).rejects.toThrow();
        expect(t.calls).toEqual(["stop-old", "write-target", "start-target", "release-target"]);
    });
    it("开放管理操作的结果未知时不回退或重启旧服务", async () => {
        const t = fixture();
        t.state.releaseFails = true;
        expect(await t.transaction.run("migration", t.backup)).toMatchObject({
            phase: "releasing-target",
            status: "interrupted",
            recoveryRequired: true,
            rolledBack: false,
        });
        expect(t.calls).toEqual(["stop-old", "write-target", "start-target", "release-target"]);
        expect(t.journal.read("migration").recoveryRequired).toBe(true);
    });
    it.each([true, false])("原运行状态%s按意图切换，每个外部效果之前已有日志", async running => {
        const t = fixture(running);
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            status: "succeeded",
            recoveryRequired: false,
            rolledBack: false,
        });
        expect(t.calls).toEqual(
            running
                ? ["stop-old", "write-target", "start-target", "release-target"]
                : ["stop-old", "write-target", "release-target"],
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
                          "reload-old",
                          "start-old",
                      ]
                    : ["stop-old", "write-target", "stop-target", "restore", "reload-old"],
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
    it("旧定义reload结果未知时保留reloading-old意图且不启动旧实例", async () => {
        const t = fixture();
        t.state.targetValid = false;
        t.state.reloadOldFails = true;
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            schemaVersion: 2,
            phase: "reloading-old",
            status: "interrupted",
            recoveryRequired: true,
            rollbackOrigin: "target-written",
        });
        expect(result).not.toHaveProperty("reloadOldReceipt");
        expect(t.calls).toEqual([
            "stop-old",
            "write-target",
            "start-target",
            "stop-target",
            "restore",
            "reload-old",
        ]);
    });
    it("旧实例启动结果未知时保留reload收据且不伪造start收据", async () => {
        const t = fixture();
        t.state.targetValid = false;
        t.state.startOldFails = true;
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            schemaVersion: 2,
            phase: "starting-old",
            status: "interrupted",
            recoveryRequired: true,
            rollbackOrigin: "target-written",
        });
        expect(result).toHaveProperty("reloadOldReceipt");
        expect(result).not.toHaveProperty("startOldReceipt");
        expect(t.calls.at(-1)).toBe("start-old");
    });
    it("旧实例已启动但start收据落盘失败时保持starting-old封锁", async () => {
        const t = fixture();
        t.state.targetValid = false;
        const transition = t.journal.transition.bind(t.journal);
        vi.spyOn(t.journal, "transition").mockImplementation((record, command) => {
            if (record.phase === "starting-old" && !("type" in command))
                throw new Error("private disk failure");
            return transition(record, command);
        });
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            phase: "starting-old",
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(result).toHaveProperty("reloadOldReceipt");
        expect(result).not.toHaveProperty("startOldReceipt");
        expect(t.calls.at(-1)).toBe("start-old");
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
    it("写目标动作报错时保留writing-target封锁且不假定可回退", async () => {
        const t = fixture();
        t.state.writeTargetFails = true;
        expect(await t.transaction.run("migration", t.backup)).toMatchObject({
            schemaVersion: 1,
            phase: "writing-target",
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(t.calls).toEqual(["stop-old", "write-target"]);
        expect(t.calls).not.toContain("stop-target");
        expect(t.calls).not.toContain("restore");
    });
    it("目标已写但target-written确认未落盘时保持v1封锁且不自动回退", async () => {
        const t = fixture();
        const transition = t.journal.transition.bind(t.journal);
        vi.spyOn(t.journal, "transition").mockImplementation((record, command) => {
            if (command.type === "target-written") throw new Error("private disk failure");
            return transition(record, command);
        });
        expect(await t.transaction.run("migration", t.backup)).toMatchObject({
            schemaVersion: 1,
            phase: "writing-target",
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(t.calls).toEqual(["stop-old", "write-target"]);
    });
    it("目标写入前确认旧服务已停后可升级为v2 pre-target回退", async () => {
        const t = fixture();
        t.state.stopOldFails = true;
        const result = await t.transaction.run("migration", t.backup);
        expect(result).toMatchObject({
            schemaVersion: 2,
            phase: "completed",
            status: "failed",
            rolledBack: true,
            rollbackOrigin: "pre-target",
        });
        expect(t.calls).toEqual(["stop-old", "restore", "reload-old", "start-old"]);
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
