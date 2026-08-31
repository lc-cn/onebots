import type { ExtensionInfo } from "../types.js";

export interface ExtensionInstallationAction {
    available: boolean;
    label: string;
}

export function getExtensionInstallationAction(
    extension: Pick<
        ExtensionInfo,
        "catalogError" | "installed" | "targetVersion" | "versionAligned"
    >,
): ExtensionInstallationAction {
    if (extension.catalogError) return { available: false, label: "目录校验失败" };
    if (!extension.targetVersion) return { available: false, label: "验证版本不可用" };
    if (!extension.installed) {
        return { available: true, label: `安装 v${extension.targetVersion} 并重启` };
    }
    if (!extension.versionAligned) {
        return { available: true, label: `切换至 v${extension.targetVersion} 并重启` };
    }
    return { available: true, label: "启用并重启" };
}
