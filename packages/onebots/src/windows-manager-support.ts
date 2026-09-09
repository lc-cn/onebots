import type { ServiceHost } from "./service-host.js";

export const WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE =
    "Windows 管理服务控制面尚未闭环：原生宿主管道目前只提供状态发布与查询，不能安全完成生命周期管理 API 与事务恢复";

/**
 * Windows SCM驱动可独立验收，但顶层变更事务必须等命名管道承载完整管理控制面。
 * 调用方必须在创建目录、写日志或派发SCM动作前调用。
 */
export function assertManagerServiceTransactionsSupported(host: ServiceHost): void {
    if (host.platform === "win32") throw new Error(WINDOWS_MANAGER_TRANSACTIONS_UNAVAILABLE);
}
