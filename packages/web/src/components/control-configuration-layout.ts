import type { ConfigurationFormGroup } from "./control-configuration-form.js";
import type { SchemaFieldDef } from "./config/types.js";

export type ConfigurationWorkspace = "accounts" | "protocols" | "runtime" | "review";
export type ConfigurationAction = "save" | "validate" | "apply" | "query" | "new-draft" | "fix";

export interface ConfigurationGroupLayout {
    runtime: ConfigurationFormGroup[];
    accounts: ConfigurationFormGroup[];
    protocols: ConfigurationFormGroup[];
}

export interface ConfigurationGroupIdentity {
    kind: "runtime" | "account" | "protocol";
    accountKey?: string;
    protocol?: string;
    scope?: "default" | "account";
}

export function configurationFieldTier(field: SchemaFieldDef): "primary" | "advanced" {
    if (field.rule.required) return "primary";
    return field.rule.ui?.section && field.rule.ui.section !== "advanced" ? "primary" : "advanced";
}

function groupPath(group: ConfigurationFormGroup): string[] {
    try {
        const value: unknown = JSON.parse(group.key);
        return Array.isArray(value) && value.every(part => typeof part === "string") ? value : [];
    } catch {
        return [];
    }
}

export function configurationGroupIdentity(
    group: ConfigurationFormGroup,
): ConfigurationGroupIdentity {
    const path = groupPath(group);
    if (!path.length) return { kind: "runtime" };
    if (path[0] === "general" && path.length === 2)
        return { kind: "protocol", protocol: path[1], scope: "default" };
    if (path.length === 1)
        return path[0].includes(".")
            ? { kind: "account", accountKey: path[0] }
            : { kind: "runtime" };
    if (path.length === 2 && path[0].includes("."))
        return {
            kind: "protocol",
            accountKey: path[0],
            protocol: path[1],
            scope: "account",
        };
    return { kind: "runtime" };
}

export function configurationGroupLayout(
    groups: ConfigurationFormGroup[],
): ConfigurationGroupLayout {
    const result: ConfigurationGroupLayout = { runtime: [], accounts: [], protocols: [] };
    for (const group of groups) {
        const identity = configurationGroupIdentity(group);
        if (identity.kind === "account") result.accounts.push(group);
        else if (identity.kind === "protocol") result.protocols.push(group);
        else result.runtime.push(group);
    }
    return result;
}

export function configuredProtocolNames(
    groups: ConfigurationFormGroup[],
    accountKey?: string,
): string[] {
    return groups.flatMap(group => {
        const identity = configurationGroupIdentity(group);
        if (
            identity.kind !== "protocol" ||
            (accountKey === undefined
                ? identity.scope !== "default"
                : identity.accountKey !== accountKey)
        )
            return [];
        return identity.protocol ? [identity.protocol] : [];
    });
}

export function configurationNextAction(input: {
    dirty: boolean;
    validation: "missing" | "valid" | "invalid";
    operation: "none" | "pending" | "resolved";
    issueCount?: number;
    issueWorkspace?: ConfigurationWorkspace;
}): {
    action: ConfigurationAction;
    workspace: ConfigurationWorkspace;
    label: string;
    detail: string;
} {
    if (input.operation === "pending")
        return {
            action: "query",
            workspace: "review",
            label: "确认应用结果",
            detail: "已有应用操作尚未完成，请查询原操作。",
        };
    if (input.operation === "resolved")
        return {
            action: "new-draft",
            workspace: "review",
            label: "开始新草稿",
            detail: "上一项应用操作已结束，可以读取当前配置继续修改。",
        };
    if (input.dirty)
        return {
            action: "save",
            workspace: "review",
            label: "保存本地修改",
            detail: "字段仍只在浏览器中，保存后才能校验。",
        };
    if (input.validation === "invalid")
        return {
            action: "fix",
            workspace: input.issueWorkspace ?? "accounts",
            label: `修正 ${input.issueCount ?? 0} 个问题`,
            detail: "返回对应模块修改错误字段，再保存并重新校验。",
        };
    if (input.validation === "missing")
        return {
            action: "validate",
            workspace: "review",
            label: "校验配置",
            detail: "检查必填项和连接参数，不会改变运行配置。",
        };
    return {
        action: "apply",
        workspace: "review",
        label: "应用配置",
        detail: "校验已通过，可以显式提交新配置版本。",
    };
}

export function configurationWorkspaceForPath(
    path: string[],
    protocolNames: string[] = [],
): ConfigurationWorkspace {
    if (path[0] === "general") return "protocols";
    if (path[0]?.includes("."))
        return path[1] && protocolNames.includes(path[1]) ? "protocols" : "accounts";
    return "runtime";
}
