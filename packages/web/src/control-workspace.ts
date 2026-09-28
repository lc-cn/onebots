import {
    IconActivity,
    IconChecklist,
    IconKey,
    IconLayoutDashboard,
    IconPackage,
    IconPlugConnected,
    IconUsers,
    type Icon,
} from "@tabler/icons-vue";

export type Workspace =
    | "overview"
    | "accounts"
    | "protocols"
    | "extensions"
    | "activity"
    | "terminal"
    | "todo"
    | "system";
export type ExtensionCategory = "platform" | "protocol" | "framework";

export interface WorkspaceNavigationItem {
    id: Workspace;
    label: string;
    hint: string;
    icon: Icon;
}

export const workspaceNavigation: WorkspaceNavigationItem[] = [
    { id: "overview", label: "概览", hint: "状态与下一步", icon: IconLayoutDashboard },
    { id: "accounts", label: "账号", hint: "账号状态与接入设置", icon: IconUsers },
    { id: "protocols", label: "协议", hint: "协议出口与连接地址", icon: IconPlugConnected },
    { id: "todo", label: "待办", hint: "处理账号验证", icon: IconChecklist },
    { id: "extensions", label: "扩展", hint: "安装与升级能力", icon: IconPackage },
    { id: "activity", label: "日志 / 调试", hint: "查看日志与消息链路", icon: IconActivity },
];

export const systemNavigation: WorkspaceNavigationItem = {
    id: "system",
    label: "系统",
    hint: "设备访问与通知",
    icon: IconKey,
};

export function workspaceFromHash(hash: string): Workspace {
    const candidate = hash.replace(/^#/, "").split("?")[0];
    return candidate === "terminal" ||
        [...workspaceNavigation, systemNavigation].some(item => item.id === candidate)
        ? (candidate as Workspace)
        : "overview";
}

export interface AccountControlRoute {
    platform: string;
    accountId: string;
}

export function accountControlFromHash(hash: string): AccountControlRoute | undefined {
    if (workspaceFromHash(hash) !== "accounts") return undefined;
    const params = new URLSearchParams(hash.split("?")[1] ?? "");
    const platform = params.get("platform");
    const accountId = params.get("account");
    if (params.get("view") !== "control" || !platform || !accountId ||
        platform.length > 512 || accountId.length > 512) return undefined;
    return { platform, accountId };
}

export function accountControlHash(route: AccountControlRoute): string {
    return `#accounts?${new URLSearchParams({ view: "control", platform: route.platform, account: route.accountId })}`;
}

export function extensionCategoryFromHash(hash: string): ExtensionCategory {
    if (workspaceFromHash(hash) !== "extensions") return "platform";
    const value = new URLSearchParams(hash.split("?")[1] ?? "").get("type");
    return value === "protocol" || value === "framework" ? value : "platform";
}

export function extensionWorkspaceHash(category: ExtensionCategory): string {
    return `#extensions?type=${category}`;
}

export function workspaceHash(workspace: Workspace): string {
    return `#${workspace}`;
}
