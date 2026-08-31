import type { ExtensionInfo } from "../types.js";

export interface ExtensionInstallationAction {
    visible: boolean;
    available: boolean;
    label: string;
}

export interface ExtensionRuntimeStatus {
    variant: "success" | "warning" | "danger" | "neutral";
    label: string;
}

export function getExtensionInstallationAction(
    extension: Pick<
        ExtensionInfo,
        "catalogError" | "enabled" | "installed" | "loaded" | "targetVersion" | "versionAligned"
    >,
): ExtensionInstallationAction {
    if (extension.catalogError) {
        return { visible: true, available: false, label: "目录校验失败" };
    }
    if (!extension.targetVersion) {
        return { visible: true, available: false, label: "验证版本不可用" };
    }
    if (!extension.installed) {
        return {
            visible: true,
            available: true,
            label: `安装 v${extension.targetVersion} 并重启`,
        };
    }
    if (!extension.versionAligned) {
        return {
            visible: true,
            available: true,
            label: `切换至 v${extension.targetVersion} 并重启`,
        };
    }
    if (!extension.enabled) {
        return { visible: true, available: true, label: "启用并重启" };
    }
    if (!extension.loaded) {
        return { visible: true, available: true, label: "重启以加载" };
    }
    return { visible: false, available: false, label: "已加载" };
}

/** 区分磁盘依赖、启动配置与当前进程，避免把半完成安装误报为已启用。 */
export function getExtensionRuntimeStatus(
    extension: Pick<ExtensionInfo, "enabled" | "installed" | "loaded">,
): ExtensionRuntimeStatus | null {
    if (extension.loaded && !extension.enabled && !extension.installed) {
        return { variant: "danger", label: "已加载，配置与依赖均缺失" };
    }
    if (extension.loaded && !extension.enabled) {
        return { variant: "warning", label: "已加载，等待停用" };
    }
    if (extension.loaded && !extension.installed) {
        return { variant: "danger", label: "已加载，依赖缺失" };
    }
    if (extension.loaded) return { variant: "success", label: "已加载" };
    if (extension.enabled && !extension.installed) {
        return { variant: "danger", label: "配置已启用，依赖缺失" };
    }
    if (extension.enabled) return { variant: "warning", label: "等待重启加载" };
    if (extension.installed) return { variant: "neutral", label: "已安装，未启用" };
    return null;
}
