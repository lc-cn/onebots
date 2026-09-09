import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileManagerServiceOperation } from "../manager-service-recovery.js";
import {
    cancelUnstartedServiceMigration,
    rollbackStoppedServiceMigration,
} from "../service-migration-recovery.js";
import { managerServiceRecoveryCommand } from "./manager-service-recovery-command.js";
import { rollbackManagerServiceUpgrade } from "../manager-service-upgrade-rollback.js";
import type { ManagerServiceRecord } from "../manager-service-journal.js";
vi.mock("../manager-service-recovery.js", () => ({ reconcileManagerServiceOperation: vi.fn() }));
vi.mock("../service-migration-recovery.js", () => ({
    cancelUnstartedServiceMigration: vi.fn(),
    rollbackStoppedServiceMigration: vi.fn(),
}));
vi.mock("../manager-service-upgrade-rollback.js", () => ({
    rollbackManagerServiceUpgrade: vi.fn(),
}));
vi.mock("./command-runner.js", () => ({ CommandRunner: () => null }));
afterEach(() => vi.mocked(reconcileManagerServiceOperation).mockReset());
afterEach(() => vi.mocked(cancelUnstartedServiceMigration).mockReset());
afterEach(() => vi.mocked(rollbackStoppedServiceMigration).mockReset());
afterEach(() => vi.mocked(rollbackManagerServiceUpgrade).mockReset());
it("only explicit migration cancellation dispatches to the early migration recovery path", async () => {
    vi.mocked(cancelUnstartedServiceMigration).mockResolvedValue({
        schemaVersion: 1,
        id: "migration_123",
        backupDigest: "a".repeat(64),
        phase: "cancelled",
        status: "failed",
        recoveryRequired: false,
        rolledBack: false,
    });
    const result = await managerServiceRecoveryCommand({
        operation: "migration_123",
        cancelMigration: true,
        system: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("尚未切换");
    expect(cancelUnstartedServiceMigration).toHaveBeenCalledWith("migration_123", "system");
    expect(reconcileManagerServiceOperation).not.toHaveBeenCalled();
    vi.mocked(cancelUnstartedServiceMigration).mockRejectedValue(new Error("synthetic-secret"));
    const failed = await managerServiceRecoveryCommand({
        operation: "migration_123",
        cancelMigration: true,
    });
    expect(failed.exitCode).toBe(1);
    expect(failed.output).not.toContain("synthetic-secret");
});
it("only explicit migration rollback restores the stopped legacy service", async () => {
    vi.mocked(rollbackStoppedServiceMigration).mockResolvedValue({
        schemaVersion: 1,
        id: "migration_123",
        backupDigest: "a".repeat(64),
        phase: "completed",
        status: "failed",
        recoveryRequired: false,
        rolledBack: true,
    });
    const result = await managerServiceRecoveryCommand({
        operation: "migration_123",
        rollbackMigration: true,
        system: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("已恢复保留的旧服务");
    expect(result.output).toContain("重新启动");
    expect(rollbackStoppedServiceMigration).toHaveBeenCalledWith("migration_123", "system");
    expect(cancelUnstartedServiceMigration).not.toHaveBeenCalled();
    expect(reconcileManagerServiceOperation).not.toHaveBeenCalled();
    vi.mocked(rollbackStoppedServiceMigration).mockRejectedValue(new Error("synthetic-secret"));
    const failed = await managerServiceRecoveryCommand({
        operation: "migration_123",
        rollbackMigration: true,
    });
    expect(failed.exitCode).toBe(1);
    expect(failed.output).toContain("未继续回退");
    expect(failed.output).not.toContain("synthetic-secret");
});
it("rejects selecting migration cancellation and rollback together before dispatch", async () => {
    const result = await managerServiceRecoveryCommand({
        operation: "migration_123",
        cancelMigration: true,
        rollbackMigration: true,
    });
    expect(result.exitCode).toBe(1);
    expect(cancelUnstartedServiceMigration).not.toHaveBeenCalled();
    expect(rollbackStoppedServiceMigration).not.toHaveBeenCalled();
    expect(reconcileManagerServiceOperation).not.toHaveBeenCalled();
});
it("显式管理升级回退恢复旧候选且重复语义不冒充升级成功", async () => {
    vi.mocked(rollbackManagerServiceUpgrade).mockResolvedValue({
        ...record(),
        action: "upgrade",
        status: "failed",
        recoveryRequired: false,
    });
    const result = await managerServiceRecoveryCommand({
        operation: "operation_123",
        rollbackUpgrade: true,
        system: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("已恢复升级前的管理程序");
    expect(rollbackManagerServiceUpgrade).toHaveBeenCalledWith("operation_123", "system");
    expect(reconcileManagerServiceOperation).not.toHaveBeenCalled();
});
const secret = "synthetic-secret-no-output";
function record(): ManagerServiceRecord {
    return {
        schemaVersion: 1,
        id: "operation_123",
        action: "stop",
        phase: "completed",
        status: "succeeded",
        recoveryRequired: false,
        desiredEnabled: false,
        managerSpecDigest: secret,
        managerSpec: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: `/private/${secret}`,
            nodePath: "/bin/node",
            binPath: "/app/bin.js",
            workingDirectory: "/app",
            host: "127.0.0.1",
            port: 6727,
        },
    };
}
describe("显式管理服务对账 CLI", () => {
    it("帮助模块导入不调用对账，operation 必填且拒绝未知选项", async () => {
        const route = await import("../commands/recover.js");
        expect(route.description).toContain("不重放");
        expect(route.options.safeParse({ system: false }).success).toBe(false);
        expect(route.options.safeParse({ system: false, operation: "../id" }).success).toBe(false);
        expect(
            route.options.safeParse({ system: false, operation: "id", force: true }).success,
        ).toBe(false);
        expect(route.options.safeParse({ system: false, operation: "id" }).success).toBe(true);
        expect(
            route.options.safeParse({
                system: false,
                operation: "id",
                cancelMigration: true,
                rollbackMigration: true,
            }).success,
        ).toBe(false);
        expect(reconcileManagerServiceOperation).not.toHaveBeenCalled();
    });
    it.each([false, true])("仅展示闭合摘要，不声称重放，system=%s", async system => {
        vi.mocked(reconcileManagerServiceOperation).mockResolvedValue(record());
        const result = await managerServiceRecoveryCommand({ operation: "operation_123", system });
        expect(reconcileManagerServiceOperation).toHaveBeenCalledExactlyOnceWith(
            "operation_123",
            system ? "system" : "user",
        );
        expect(result).toEqual({
            exitCode: 0,
            output: "操作 operation_123：succeeded（completed）\n已确认该服务操作达到目标；仅更新对账记录，未重放系统动作。",
        });
        expect(result.output).not.toContain(secret);
    });
    it.each(["start", "upgrade", "install"] as const)("%s 对账成功时明确只补日志", async action => {
        vi.mocked(reconcileManagerServiceOperation).mockResolvedValue({ ...record(), action });
        const result = await managerServiceRecoveryCommand({ operation: "operation_123" });
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("仅更新对账记录，未重放系统动作");
        expect(result.output).not.toContain(secret);
    });
    it.each(["", "../id", "a b", "a\n", "a".repeat(129)])(
        "非法 ID %s 不调用服务",
        async operation => {
            expect((await managerServiceRecoveryCommand({ operation })).exitCode).toBe(1);
            expect(reconcileManagerServiceOperation).not.toHaveBeenCalled();
        },
    );
    it.each(["running", "failed", "interrupted", "succeeded"] as const)(
        "%s 未知状态保留记录不称完成",
        async status => {
            vi.mocked(reconcileManagerServiceOperation).mockResolvedValue({
                ...record(),
                status,
                recoveryRequired: true,
            });
            const result = await managerServiceRecoveryCommand({ operation: "operation_123" });
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain("保留操作记录，未重放");
            expect(result.output).not.toContain("已确认该");
            expect(result.output).not.toContain(secret);
        },
    );
    it("其他动作即使返回成功也不称完整恢复", async () => {
        vi.mocked(reconcileManagerServiceOperation).mockResolvedValue({
            ...record(),
            action: "restart",
        });
        expect((await managerServiceRecoveryCommand({ operation: "operation_123" })).exitCode).toBe(
            1,
        );
    });
    it("错误和非法返回字段不泄漏秘密", async () => {
        vi.mocked(reconcileManagerServiceOperation).mockRejectedValue(new Error(secret));
        const result = await managerServiceRecoveryCommand({ operation: "operation_123" });
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("保留操作记录，未重放");
        expect(result.output).not.toContain(secret);
        const value = record();
        Reflect.set(value, "phase", secret);
        vi.mocked(reconcileManagerServiceOperation).mockResolvedValue(value);
        expect(
            (await managerServiceRecoveryCommand({ operation: "operation_123" })).output,
        ).not.toContain(secret);
    });
});
