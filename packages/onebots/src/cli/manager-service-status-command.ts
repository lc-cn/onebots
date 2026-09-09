import {
    inspectManagerServiceStatus,
    type ManagerServiceStatus,
} from "../manager-service-status.js";
import type { ScopeOptions } from "./command-options.js";
import type { CommandResult } from "./command-application.js";
const stateNames = {
    running: "运行中",
    stopped: "已停止",
    transitioning: "转换中",
    failed: "失败",
    unknown: "未知",
    starting: "启动中",
    stopping: "停止中",
};
const diagnostics: Record<NonNullable<ManagerServiceStatus["diagnostic"]>, string> = {
    "definition-mismatch": "管理服务定义与元数据不匹配，拒绝认领当前 OS 服务。",
    "not-installed": "尚未安装管理服务。",
    "migration-required": "检测到旧服务，请先执行 onebots migrate。",
    "invalid-metadata": "服务元数据无效，拒绝猜测服务状态；请在本机检查安装记录。",
    "os-unavailable": "OS 服务状态无法确认。",
    "ipc-unavailable": "管理服务 IPC 不可达，网关状态未知。",
    "identity-mismatch": "OS 与 IPC 实例身份不匹配，网关状态未知。",
    "baseline-changed": "查询期间服务实例或元数据变化，请重新查询。",
};
/** status只调用新只读边界；不能回退旧生命周期控制器或业务配置探针。 */
export async function managerServiceStatusCommand(
    options: ScopeOptions & { json?: boolean },
): Promise<CommandResult> {
    const status = await inspectManagerServiceStatus(options.system ? "system" : "user");
    const exitCode =
        status.serviceRecoveryRequired ||
        status.diagnostic ||
        status.manager.state === "failed" ||
        status.gateway.actual === "failed" ||
        status.gateway.recoveryRequired
            ? 1
            : 0;
    if (options.json) return { output: JSON.stringify(status, null, 2), exitCode };
    const recoveryMessage = "系统服务操作或迁移结果尚待核实，请在本机对账，勿重复启停或安装。";
    const recoveryLines: string[] = [];
    if (!status.recovery.readable)
        recoveryLines.push("操作记录无法完整读取，未展示不可信的操作列表。");
    else {
        for (const operation of status.recovery.operations)
            recoveryLines.push(
                `待核实操作 ${operation.id}：${operation.action ?? "迁移"} / ${operation.status}（${operation.phase}）`,
            );
        if (status.recovery.truncated)
            recoveryLines.push("仅显示前 100 条；存在更多待核实记录，不能单独解除阻断。");
        const operation = status.recovery.operations[0];
        if (
            !status.recovery.truncated &&
            status.recovery.operations.length === 1 &&
            operation.kind === "manager" &&
            ["stop", "uninstall"].includes(operation.action ?? "")
        )
            recoveryLines.push(
                `核验目标是否已达到：onebots recover --operation ${operation.id}${options.system ? " --system" : ""}（不会重放系统动作）。`,
            );
    }
    if (status.installation !== "control")
        return {
            output:
                diagnostics[status.diagnostic!] +
                (status.serviceRecoveryRequired ? "\n" + recoveryMessage : "") +
                (recoveryLines.length ? "\n" + recoveryLines.join("\n") : ""),
            exitCode,
        };
    const enabled =
        status.manager.enabled === null ? "未知" : status.manager.enabled ? "已启用" : "已禁用";
    const lines = [
        `管理服务（OS）：${stateNames[status.manager.state]}；${enabled}`,
        `网关：实际${stateNames[status.gateway.actual]}；期望${stateNames[status.gateway.desired]}`,
    ];
    if (status.gateway.knownConfigurationFailure)
        lines.push("网关配置无效，管理服务仍在运行，可通过控制台修复。");
    if (status.gateway.recoveryRequired) lines.push("网关前次操作结果尚待核实。");
    if (status.serviceRecoveryRequired) lines.push(recoveryMessage);
    lines.push(...recoveryLines);
    if (status.diagnostic) lines.push(diagnostics[status.diagnostic]);
    return { output: lines.join("\n"), exitCode };
}
