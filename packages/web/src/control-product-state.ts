import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import type { NotificationSnapshot } from "./notification-model.js";

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
    nextWorkspace: "extensions" | "accounts" | "protocols" | "overview" | "activity";
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
    let hasAccountProtocol = false;
    if (selection && configuration) {
        const protocolNames = Object.keys(configuration.schemas.protocols ?? {});
        const accounts = Object.entries(configuration.document).filter(([key]) =>
            selection.adapters.some(adapter => key.startsWith(`${adapter}.`)),
        );
        counts.accounts = accounts.length;
        hasAccountProtocol = accounts.some(
            ([, value]) =>
                value !== null &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                protocolNames.some(protocol => Object.hasOwn(value, protocol)),
        );
    }

    let state: SetupJourneyState;
    if (unavailable) state = "unavailable";
    else if (!catalog || !configuration || !status) state = "loading";
    else if (status.gateway.recoveryRequired) state = "recovery";
    else if (!counts.adapters || !counts.protocols) state = "needs-extensions";
    else if (!counts.accounts || !hasAccountProtocol) state = "needs-configuration";
    else if (status.gateway.actual !== "running") state = "ready-to-start";
    else state = "running";

    const extensionComplete = counts.adapters > 0 && counts.protocols > 0;
    const configurationComplete = extensionComplete && counts.accounts > 0 && hasAccountProtocol;
    const gatewayComplete = state === "running";
    const stepStatus = (complete: boolean, current: boolean): SetupJourneyStep["status"] =>
        complete ? "complete" : current ? "current" : "pending";

    return {
        state,
        nextWorkspace:
            state === "needs-extensions"
                ? "extensions"
                : state === "needs-configuration"
                  ? counts.accounts
                      ? "protocols"
                      : "accounts"
                  : state === "recovery"
                    ? "activity"
                    : "overview",
        nextLabel:
            state === "needs-extensions"
                ? "选择平台与协议"
                : state === "needs-configuration"
                  ? counts.accounts
                      ? "为账号配置协议出口"
                      : "配置第一个账号"
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
                    ? hasAccountProtocol
                        ? `${counts.accounts} 个平台账号已配置，协议出口已添加`
                        : `${counts.accounts} 个平台账号已配置，仍需添加协议出口`
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

export type AttentionAction =
    | "diagnostics"
    | "verification"
    | "notification-history"
    | "notification-setup"
    | "accounts"
    | "account-configuration"
    | "protocol-configuration"
    | "extensions";

export interface AttentionItem {
    action: AttentionAction;
    title: string;
    detail: string;
}

/** 只根据已确认的状态给出下一步，不把加载失败或未知状态误报为故障。 */
export function controlAttention(
    status: ControlStatus | undefined,
    journey: SetupJourney,
    notifications: NotificationSnapshot | undefined,
    pendingVerificationCount: number | undefined,
): AttentionItem[] {
    const items: AttentionItem[] = [];
    if (status?.gateway.recoveryRequired || status?.gateway.actual === "failed")
        items.push({
            action: "diagnostics",
            title: status.gateway.recoveryRequired ? "网关需要恢复" : "网关启动失败",
            detail: "核对最近操作与服务日志",
        });
    if (pendingVerificationCount)
        items.push({
            action: "verification",
            title: `${pendingVerificationCount} 项账号验证待处理`,
            detail: "打开待办完成登录交互",
        });
    if (notifications) {
        const failed = notifications.deliveries.filter(item => item.status === "failed").length;
        if (failed || notifications.droppedDeliveries)
            items.push({
                action: "notification-history",
                title: failed ? `${failed} 条通知投递失败` : "通知队列曾溢出",
                detail: "查看投递记录与渠道故障",
            });
    }
    if (status?.gateway.actual === "running" && status.accounts?.available) {
        const offline = status.accounts.items.filter(item => item.status === "offline").length;
        if (offline)
            items.push({
                action: "accounts",
                title: `${offline} 个账号离线`,
                detail: "查看账号与协议状态",
            });
        const failedProtocols = status.accounts.items.reduce(
            (count, account) =>
                count +
                (account.protocols?.filter(protocol => protocol.status === "failed").length ?? 0),
            0,
        );
        if (failedProtocols)
            items.push({
                action: "protocol-configuration",
                title: `${failedProtocols} 个协议出口失败`,
                detail: "检查协议配置与运行状态",
            });
    }
    if (journey.state === "needs-extensions" || journey.state === "needs-configuration")
        items.push({
            action:
                journey.state === "needs-extensions"
                    ? "extensions"
                    : journey.nextWorkspace === "protocols"
                      ? "protocol-configuration"
                      : "account-configuration",
            title: journey.nextLabel,
            detail: journey.state === "needs-extensions" ? "继续准备接入能力" : "完成账号连接设置",
        });
    if (journey.state === "running" && notifications) {
        // 暂停规则或渠道是用户选择，不当作首次配置缺失反复催促。
        const configuredChannels = new Set(
            notifications.config.channels.map(channel => channel.id),
        );
        if (
            !notifications.config.rules.some(
                rule =>
                    rule.events.length && rule.channelIds.some(id => configuredChannels.has(id)),
            )
        )
            items.push({
                action: "notification-setup",
                title: "设置故障通知",
                detail: "选择接收渠道和告警事件",
            });
    }
    return items;
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
