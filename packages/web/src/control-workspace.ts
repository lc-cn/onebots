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
    { id: "extensions", label: "扩展版本", hint: "安装并激活运行版本", icon: IconPackage },
    { id: "configuration", label: "账号与协议", hint: "管理账号与协议出口", icon: IconSettings },
    { id: "activity", label: "运行与诊断", hint: "验证、消息和日志", icon: IconActivity },
    { id: "access", label: "设备与访问", hint: "管理已授权设备", icon: IconKey },
];
