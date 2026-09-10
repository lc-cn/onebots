import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";

export type WorkspaceReadiness = "loading" | "empty" | "configured" | "unavailable";

export type SetupJourneyState =
    | "loading"
    | "unavailable"
    | "needs-extensions"
    | "needs-configuration"
    | "ready-to-start"
    | "recovery"
    | "running";

export interface SetupJourneyStep {
    id: "extensions" | "configuration" | "gateway";
    label: string;
    detail: string;
    status: "pending" | "current" | "complete";
}

export interface SetupJourney {
    state: SetupJourneyState;
    nextWorkspace: "extensions" | "configuration" | "overview" | "activity";
    nextLabel: string;
    counts: {
        adapters: number;
        protocols: number;
        applications: number;
        accounts: number;
    };
    steps: SetupJourneyStep[];
}

/** 将安装、配置和运行三组事实整理成用户可以继续执行的首次使用路径。 */
export function setupJourney(
    catalog: ControlInstallationCatalog | undefined,
    configuration: ControlConfigurationSnapshot | undefined,
    status: ControlStatus | undefined,
    unavailable = false,
): SetupJourney {
    const selection = catalog?.selection;
    const counts = {
        adapters: selection?.adapters.length ?? 0,
        protocols: selection?.protocols.length ?? 0,
        applications: selection?.applications.length ?? 0,
        accounts: 0,
    };
    if (selection && configuration) {
        counts.accounts = Object.keys(configuration.document).filter(key =>
            selection.adapters.some(adapter => key.startsWith(`${adapter}.`)),
        ).length;
    }

    let state: SetupJourneyState;
    if (unavailable) state = "unavailable";
    else if (!catalog || !configuration || !status) state = "loading";
    else if (status.gateway.recoveryRequired) state = "recovery";
    else if (!counts.adapters || !counts.protocols) state = "needs-extensions";
    else if (!counts.accounts) state = "needs-configuration";
    else if (status.gateway.actual !== "running") state = "ready-to-start";
    else state = "running";

    const extensionComplete = counts.adapters > 0 && counts.protocols > 0;
    const configurationComplete = extensionComplete && counts.accounts > 0;
    const gatewayComplete = state === "running";
    const stepStatus = (complete: boolean, current: boolean): SetupJourneyStep["status"] =>
        complete ? "complete" : current ? "current" : "pending";

    return {
        state,
        nextWorkspace:
            state === "needs-extensions"
                ? "extensions"
                : state === "needs-configuration"
                  ? "configuration"
                  : state === "recovery"
                    ? "activity"
                    : "overview",
        nextLabel:
            state === "needs-extensions"
                ? "选择平台与协议"
                : state === "needs-configuration"
                  ? "配置第一个账号"
                  : state === "ready-to-start"
                    ? "检查并启动网关"
                    : state === "recovery"
                      ? "打开恢复诊断"
                      : state === "running"
                        ? "查看运行状态"
                        : "等待工作区信息",
        counts,
        steps: [
            {
                id: "extensions",
                label: "选择能力",
                detail: counts.adapters
                    ? `${counts.adapters} 个平台 · ${counts.protocols} 个协议 · ${counts.applications} 个框架`
                    : "选择接入平台、输出协议和框架",
                status: stepStatus(extensionComplete, state === "needs-extensions"),
            },
            {
                id: "configuration",
                label: "配置连接",
                detail: counts.accounts
                    ? `${counts.accounts} 个平台账号已配置`
                    : "填写账号凭据与协议连接参数",
                status: stepStatus(configurationComplete, state === "needs-configuration"),
            },
            {
                id: "gateway",
                label: "启动并验证",
                detail:
                    state === "recovery"
                        ? "上一操作需要人工核对"
                        : gatewayComplete
                          ? "网关正在运行"
                          : "启动网关并完成平台验证",
                status: stepStatus(
                    gatewayComplete,
                    state === "ready-to-start" || state === "recovery",
                ),
            },
        ],
    };
}

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
