import type { ServiceHost } from "./service-host.js";

export const WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE =
    "Windows 管理服务只支持管理员安装的 system 范围";

/**
 * Windows SCM驱动可独立验收，但顶层变更事务必须等命名管道承载完整管理控制面。
 * 调用方必须在创建目录、写日志或派发SCM动作前调用。
 */
export function assertManagerServiceTransactionsSupported(host: ServiceHost): void {
    if (
        host.platform === "win32" &&
        (host.isElevated !== true ||
            typeof host.windowsSid !== "string" ||
            !/^S-1-(?:[0-9]+-)+[0-9]+$/.test(host.windowsSid))
    )
        throw new Error(WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE);
}
