import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileManagerServiceOperation } from "../manager-service-recovery.js";
import { managerServiceRecoveryCommand } from "./manager-service-recovery-command.js";
import type { ManagerServiceRecord } from "../manager-service-journal.js";
vi.mock("../manager-service-recovery.js", () => ({ reconcileManagerServiceOperation: vi.fn() }));
vi.mock("./command-runner.js", () => ({ CommandRunner: () => null }));
vi.mock("../service-manager.js", () => {
    throw new Error("禁止旧恢复旁路");
});
afterEach(() => vi.mocked(reconcileManagerServiceOperation).mockReset());
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
            output: "操作 operation_123：succeeded（completed）\n已确认该停止或卸载操作达到目标；仅更新对账记录，未重放系统动作。",
        });
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
            action: "start",
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
