import { reconcileManagerServiceOperation } from "../manager-service-recovery.js";
import {
    cancelUnstartedServiceMigration,
    rollbackStoppedServiceMigration,
} from "../service-migration-recovery.js";
import { rollbackManagerServiceUpgrade } from "../manager-service-upgrade-rollback.js";
import type { CommandResult } from "./command-application.js";
import { createDefaultServiceHost } from "../service-host.js";
import { rollbackWindowsServiceMigration } from "../service-migration-windows.js";

export interface ManagerServiceRecoveryOptions {
    operation: string;
    system?: boolean;
    cancelMigration?: boolean;
    rollbackMigration?: boolean;
    rollbackUpgrade?: boolean;
}
const pending =
    "未确认已达到安装、启动、停止、卸载或已释放升级的目标；保留操作记录，未重放任何系统动作。这不是完整自动恢复。";
const phases = new Set([
    "prepared",
    "stopping",
    "restoring-enablement",
    "starting",
    "writing",
    "removing-definition",
    "unregistering",
    "removing-metadata",
    "removing",
    "verifying",
    "releasing",
    "completed",
]);
export async function managerServiceRecoveryCommand(
    options: ManagerServiceRecoveryOptions,
): Promise<CommandResult> {
    if (
        typeof options.operation !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(options.operation) ||
        (options.system !== undefined && typeof options.system !== "boolean") ||
        (options.cancelMigration !== undefined && typeof options.cancelMigration !== "boolean") ||
        (options.rollbackMigration !== undefined &&
            typeof options.rollbackMigration !== "boolean") ||
        (options.rollbackUpgrade !== undefined && typeof options.rollbackUpgrade !== "boolean") ||
        [options.cancelMigration, options.rollbackMigration, options.rollbackUpgrade].filter(
            Boolean,
        ).length > 1
    )
        return {
            exitCode: 1,
            output: "必须指定 --operation，值为 1 至 128 位字母、数字、下划线或短横线；未读取或更改服务记录。",
        };
    try {
        if (options.rollbackUpgrade) {
            const record = await rollbackManagerServiceUpgrade(
                options.operation,
                options.system ? "system" : "user",
            );
            if (
                record.id !== options.operation ||
                record.action !== "upgrade" ||
                record.phase !== "completed" ||
                record.status !== "failed" ||
                record.recoveryRequired
            )
                throw new Error();
            return {
                exitCode: 0,
                output: `操作 ${record.id}：已恢复升级前的管理程序。\n服务定义、启用状态与原网关运行意图已核验；重复执行只读确认，不会再次停止、写入或启动。`,
            };
        }
        if (options.rollbackMigration) {
            const host = createDefaultServiceHost();
            if (host.platform === "win32") {
                if (!options.system) throw new Error();
                const record = await rollbackWindowsServiceMigration(options.operation, host);
                if (
                    record.phase !== "rolled-back" ||
                    record.status !== "failed" ||
                    record.recoveryRequired ||
                    !record.rolledBack
                )
                    throw new Error();
                return {
                    exitCode: 0,
                    output: `操作 ${record.id}：已恢复并核验 Windows 旧服务。\n重启收据 helper 已删除，旧 SCM 启动类型与原运行意图均已恢复。`,
                };
            }
            const record = await rollbackStoppedServiceMigration(
                options.operation,
                options.system ? "system" : "user",
            );
            if (
                record.id !== options.operation ||
                record.phase !== "completed" ||
                record.status !== "failed" ||
                record.recoveryRequired ||
                !record.rolledBack
            )
                throw new Error();
            return {
                exitCode: 0,
                output: `操作 ${record.id}：已恢复保留的旧服务。\n若迁移前旧服务处于运行状态，已重新启动并完成稳定性核验；迁移记录和备份仍保留。`,
            };
        }
        if (options.cancelMigration) {
            const record = await cancelUnstartedServiceMigration(
                options.operation,
                options.system ? "system" : "user",
            );
            if (
                record.id !== options.operation ||
                record.phase !== "cancelled" ||
                record.status !== "failed" ||
                record.recoveryRequired ||
                record.rolledBack
            )
                throw new Error();
            return {
                exitCode: 0,
                output: `操作 ${record.id}：已取消尚未切换的迁移。\n旧服务未重启，配置、备份和捕获工件均保留；修复依赖后可重新执行 migrate。`,
            };
        }
        const record = await reconcileManagerServiceOperation(
            options.operation,
            options.system ? "system" : "user",
        );
        if (
            record.id !== options.operation ||
            !phases.has(record.phase) ||
            !["running", "succeeded", "failed", "interrupted"].includes(record.status)
        )
            return { exitCode: 1, output: pending };
        const summary = `操作 ${record.id}：${record.status}（${record.phase}）`;
        if (
            record.status === "succeeded" &&
            record.phase === "completed" &&
            !record.recoveryRequired &&
            ["start", "stop", "uninstall", "upgrade", "install"].includes(record.action)
        )
            return {
                exitCode: 0,
                output: `${summary}\n已确认该服务操作达到目标；仅更新对账记录，未重放系统动作。`,
            };
        return { exitCode: 1, output: `${summary}\n${pending}` };
    } catch {
        return {
            exitCode: 1,
            output: options.rollbackUpgrade
                ? "无法证明新候选可安全停止或旧候选已完整恢复，保留升级回退阶段；未重复派发系统动作。"
                : options.rollbackMigration
                  ? "无法确认旧服务已停止且目标尚未接管，保留恢复记录；未继续回退。"
                  : options.cancelMigration
                    ? "无法确认迁移尚未切换且旧服务未变，保留恢复记录；未执行系统动作。"
                    : pending,
        };
    }
}
