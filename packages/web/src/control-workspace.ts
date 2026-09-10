import {
    IconActivity,
    IconKey,
    IconLayoutDashboard,
    IconPackage,
    IconSettings,
    type Icon,
} from "@tabler/icons-vue";

export type Workspace = "overview" | "extensions" | "configuration" | "activity" | "access";

export interface WorkspaceNavigationItem {
    id: Workspace;
    label: string;
    hint: string;
    icon: Icon;
}

export const workspaceNavigation: WorkspaceNavigationItem[] = [
    { id: "overview", label: "运行概览", hint: "服务状态与快捷操作", icon: IconLayoutDashboard },
    { id: "extensions", label: "安装与扩展", hint: "选择平台、协议与框架", icon: IconPackage },
    { id: "configuration", label: "账号与协议", hint: "管理账号与协议出口", icon: IconSettings },
    { id: "activity", label: "运行与诊断", hint: "验证、消息和日志", icon: IconActivity },
    { id: "access", label: "设备与访问", hint: "管理已授权设备", icon: IconKey },
];

export function workspaceFromHash(hash: string): Workspace {
    const candidate = hash.replace(/^#/, "");
    return workspaceNavigation.some(item => item.id === candidate)
        ? (candidate as Workspace)
        : "overview";
}

export function workspaceHash(workspace: Workspace): string {
    return `#${workspace}`;
}
