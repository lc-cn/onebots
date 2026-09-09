import { reconcileManagerServiceOperation } from "../manager-service-recovery.js";
import type { CommandResult } from "./command-application.js";

export interface ManagerServiceRecoveryOptions {
    operation: string;
    system?: boolean;
}
const pending =
    "未确认已达到安装、停止、卸载或已释放升级的目标；保留操作记录，未重放任何系统动作。这不是完整自动恢复。";
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
        (options.system !== undefined && typeof options.system !== "boolean")
    )
        return {
            exitCode: 1,
            output: "必须指定 --operation，值为 1 至 128 位字母、数字、下划线或短横线；未读取或更改服务记录。",
        };
    try {
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
            ["stop", "uninstall", "upgrade", "install"].includes(record.action)
        )
            return {
                exitCode: 0,
                output: `${summary}\n已确认该服务操作达到目标；仅更新对账记录，未重放系统动作。`,
            };
        return { exitCode: 1, output: `${summary}\n${pending}` };
    } catch {
        return { exitCode: 1, output: pending };
    }
}
