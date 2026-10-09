import type {
    ControlConfigurationOperation,
    ControlConfigurationValidation,
} from "@onebots/core/control";

export type ConfigurationImpact = NonNullable<ControlConfigurationValidation["impact"]>;

/** 只描述服务端校验出的影响，不从编辑字段推断生命周期。 */
export function configurationImpactSummary(impact: ConfigurationImpact): string {
    if (impact.mode === "none") return "配置没有变化，无需更新连接。";
    if (impact.mode === "restart") return "需要重启网关，所有账号和协议连接将短暂中断。";
    const counts = [
        [impact.accounts.filter(item => item.action === "add").length, "新增账号"],
        [impact.accounts.filter(item => item.action === "reconnect").length, "重连账号"],
        [impact.accounts.filter(item => item.action === "remove").length, "移除账号"],
        [impact.protocols.length, "更新协议出口"],
        [impact.dynamicFields.length, "更新动态设置"],
    ] as const;
    return (
        counts
            .filter(([count]) => count > 0)
            .map(([count, label]) => `${label} ${count} 项`)
            .join(" · ") || "按实例更新配置。"
    );
}

export function configurationOperationMessage(operation: ControlConfigurationOperation): string {
    if (operation.executionMode === "stored") return "设置已保存，将在下次启动网关时生效。";
    if (operation.impact?.mode === "none") return "配置没有变化，连接保持原状。";
    if (operation.executionMode === "hot") return "设置已按实例更新，无需重启网关。";
    if (operation.executionMode === "restart") return "设置已保存，网关已重新启动。";
    return "设置已保存并生效。";
}
