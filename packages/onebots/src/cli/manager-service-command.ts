import { controlManagerService, type ManagerControlAction } from "../manager-service-controller.js";
import type { CommandResult } from "./command-application.js";
import type { ScopeOptions } from "./command-options.js";

const labels = { start: "启动", stop: "停止", restart: "重启" };
/** 系统服务命令只管理manager，不修改网关desired，不回退旧gateway服务路径。 */
export async function managerServiceCommand(
    action: ManagerControlAction,
    options: ScopeOptions,
): Promise<CommandResult> {
    try {
        const record = await controlManagerService(action, options.system ? "system" : "user");
        const summary = `操作 ${record.id}：${record.status}（${record.phase}）`;
        if (record.status === "succeeded" && !record.recoveryRequired)
            return {
                output: `${summary}\n管理服务已${labels[action]}，保留网关期望状态与系统服务启用设置。`,
                exitCode: 0,
            };
        return {
            output: `${summary}\n管理服务操作未确认成功，请在本机对账；未改变网关期望状态，请勿重复执行。${action === "stop" ? `\n可执行 onebots recover --operation ${record.id}${options.system ? " --system" : ""} 核验是否已停止；该命令不会重放系统动作。` : ""}`,
            exitCode: 1,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const known =
            message === "旧服务须先执行 onebots migrate"
                ? "检测到旧服务，请先执行 onebots migrate；未回退旧服务控制路径。"
                : message === "尚未安装管理服务"
                  ? "尚未安装管理服务。"
                  : message === "系统级服务需要管理员权限"
                    ? "系统级服务需要管理员权限，未执行服务操作。"
                    : "管理服务操作未完成，操作标识暂不可用；请检查本机服务记录，勿重复执行。";
        return { output: known, exitCode: 1 };
    }
}
