import { uninstallManagerService } from "../manager-service-uninstall.js";
import type { ScopeOptions } from "./command-options.js";
import type { CommandResult } from "./command-application.js";

export async function managerServiceUninstallCommand(
    options: ScopeOptions,
): Promise<CommandResult> {
    try {
        const record = await uninstallManagerService(options.system ? "system" : "user");
        const summary = `操作 ${record.id}：${record.status}（${record.phase}）`;
        if (record.status === "succeeded" && !record.recoveryRequired)
            return {
                output: `${summary}\n系统托管已卸载，工作区、认证、配置、账号数据及日志全部保留。`,
                exitCode: 0,
            };
        return {
            output: `${summary}\n卸载结果尚待对账，保留操作记录；请勿重复卸载或重新安装。`,
            exitCode: 1,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        return {
            output:
                message === "旧服务须先执行 onebots migrate"
                    ? "检测到旧服务，请先执行 onebots migrate；未使用旧卸载路径。"
                    : message === "系统级服务需要管理员权限"
                      ? "系统级服务需要管理员权限，未执行卸载。"
                      : "管理服务卸载未完成，请检查本机服务记录；不会根据元数据缺失猜测已卸载。",
            exitCode: 1,
        };
    }
}
