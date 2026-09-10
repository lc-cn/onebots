import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";

export type WorkspaceReadiness = "loading" | "empty" | "configured" | "unavailable";

export function workspaceReadiness(
    catalog: ControlInstallationCatalog | undefined,
    configuration: ControlConfigurationSnapshot | undefined,
    unavailable = false,
): WorkspaceReadiness {
    if (unavailable) return "unavailable";
    if (!catalog || !configuration) return "loading";
    const selected = [
        ...catalog.selection.adapters,
        ...catalog.selection.protocols,
        ...catalog.selection.applications,
    ];
    const hasRuntime = catalog.activeGenerationId !== null || selected.length > 0;
    const hasConfigurationGeneration = configuration.base.generationId !== null;
    const hasUnprojectedConfiguration = configuration.unknownPaths.length > 0;
    return hasRuntime || hasConfigurationGeneration || hasUnprojectedConfiguration
        ? "configured"
        : "empty";
}

export interface ControlMutationBlock {
    kind: "service-recovery" | "service-migration" | "process-ownership";
    title: string;
    detail: string;
}

export function controlMutationBlock(
    status: ControlStatus | undefined,
): ControlMutationBlock | undefined {
    if (status?.serviceMigration?.recoveryRequired)
        return {
            kind: "service-recovery",
            title: "服务迁移需要人工恢复",
            detail: "迁移记录无法安全核实。运行时修改已锁定，请通过本机控制入口完成对账。",
        };
    if (status?.serviceMigration?.pending)
        return {
            kind: "service-migration",
            title: "服务迁移尚未确认",
            detail: "管理服务正在等待本机确认。确认完成前，控制台保持只读。",
        };
    if (status?.processOwnership?.available === false)
        return {
            kind: "process-ownership",
            title: "管理进程所有权无法确认",
            detail: "当前服务不能安全证明历史进程归属。运行时修改已锁定，仅保留读取与诊断。",
        };
    return undefined;
}
