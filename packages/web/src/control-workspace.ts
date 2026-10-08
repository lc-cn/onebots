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

function routeParts(location: string): { segments: string[]; query: URLSearchParams } | undefined {
    try {
        const url = new URL(location, "http://localhost");
        const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        if (segments.some(value => !value || value.length > 512)) return undefined;
        return {
            segments: segments[0] === "console" ? segments.slice(1) : [],
            query: url.searchParams,
        };
    } catch {
        return undefined;
    }
}

export function workspaceFromPath(location: string): Workspace {
    const candidate = routeParts(location)?.segments[0];
    return candidate === "terminal" ||
        [...workspaceNavigation, systemNavigation].some(item => item.id === candidate)
        ? (candidate as Workspace)
        : "overview";
}

export function workspacePath(workspace: Workspace): string {
    return `/console/${workspace}`;
}

export type EntityPage = "list" | "detail" | "create" | "edit";
export interface AccountPageRoute {
    page: EntityPage;
    platform?: string;
    accountId?: string;
}
export interface ProtocolPageRoute extends AccountPageRoute {
    protocolKey?: string;
    defaultScope?: boolean;
}
export interface AccountControlRoute {
    platform: string;
    accountId: string;
}

export function accountPageFromPath(location: string): AccountPageRoute {
    const route = routeParts(location);
    if (route?.segments[0] !== "accounts") return { page: "list" };
    const [, platform, accountId, action] = route.segments;
    if (platform === "new" && route.segments.length === 2) {
        const requested = route.query.get("platform");
        return {
            page: "create",
            ...(requested && requested.length <= 512 ? { platform: requested } : {}),
        };
    }
    if (platform && accountId && route.segments.length === 3)
        return { page: "detail", platform, accountId };
    if (platform && accountId && action === "edit" && route.segments.length === 4)
        return { page: "edit", platform, accountId };
    return { page: "list" };
}

export function accountPagePath(route: AccountPageRoute): string {
    if (route.page === "list") return "/console/accounts";
    if (route.page === "create")
        return `/console/accounts/new${route.platform ? `?platform=${encodeURIComponent(route.platform)}` : ""}`;
    return `/console/accounts/${encodeURIComponent(route.platform ?? "")}/${encodeURIComponent(route.accountId ?? "")}${route.page === "edit" ? "/edit" : ""}`;
}

export function accountControlFromPath(location: string): AccountControlRoute | undefined {
    const segments = routeParts(location)?.segments;
    if (segments?.[0] !== "accounts" || segments.length !== 4 || segments[3] !== "control")
        return undefined;
    return { platform: segments[1], accountId: segments[2] };
}

export function accountControlPath(route: AccountControlRoute): string {
    return `/console/accounts/${encodeURIComponent(route.platform)}/${encodeURIComponent(route.accountId)}/control`;
}

export function protocolPageFromPath(location: string): ProtocolPageRoute {
    const route = routeParts(location);
    if (route?.segments[0] !== "protocols") return { page: "list" };
    const [, platform, accountId, protocolKey, action] = route.segments;
    if (platform === "new" && route.segments.length === 2) {
        const requestedPlatform = route.query.get("platform");
        const requestedAccount = route.query.get("account");
        const requestedProtocol = route.query.get("protocol");
        return {
            page: "create",
            ...(requestedPlatform &&
            requestedAccount &&
            requestedPlatform.length <= 512 &&
            requestedAccount.length <= 512
                ? { platform: requestedPlatform, accountId: requestedAccount }
                : {}),
            ...(requestedProtocol && requestedProtocol.length <= 512
                ? { protocolKey: requestedProtocol }
                : {}),
        };
    }
    if (platform === "defaults" && accountId && route.segments.length === 3)
        return { page: "create", protocolKey: accountId, defaultScope: true };
    if (platform && accountId && protocolKey && route.segments.length === 4)
        return { page: "detail", platform, accountId, protocolKey };
    if (platform && accountId && protocolKey && action === "edit" && route.segments.length === 5)
        return { page: "edit", platform, accountId, protocolKey };
    return { page: "list" };
}

export function protocolPagePath(route: ProtocolPageRoute): string {
    if (route.page === "list") return "/console/protocols";
    if (route.defaultScope && route.protocolKey)
        return `/console/protocols/defaults/${encodeURIComponent(route.protocolKey)}`;
    if (route.page === "create") {
        const query = new URLSearchParams();
        if (route.platform) query.set("platform", route.platform);
        if (route.accountId) query.set("account", route.accountId);
        if (route.protocolKey) query.set("protocol", route.protocolKey);
        return `/console/protocols/new${query.size ? `?${query}` : ""}`;
    }
    return `/console/protocols/${encodeURIComponent(route.platform ?? "")}/${encodeURIComponent(route.accountId ?? "")}/${encodeURIComponent(route.protocolKey ?? "")}${route.page === "edit" ? "/edit" : ""}`;
}

export function extensionCategoryFromPath(location: string): ExtensionCategory {
    const route = routeParts(location);
    if (route?.segments[0] !== "extensions") return "platform";
    const value = route.query.get("type");
    return value === "protocol" || value === "framework" ? value : "platform";
}

export function extensionWorkspacePath(category: ExtensionCategory): string {
    return `/console/extensions?type=${category}`;
}
