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

export interface ExtensionInstallationProgress {
    variant: "warning" | "danger";
    label: string;
    detail: string | null;
}

export type ExtensionInstallRequestRecovery =
    | { status: "running" }
    | { status: "succeeded" }
    | { status: "failed"; message: string }
    | { status: "unknown" };

export interface ExtensionInstallCompletion {
    restart: boolean;
    message: string | null;
}

/** 新服务端显式声明监督能力；旧服务端保持原有自动重启行为。 */
export function getExtensionInstallCompletion(result: {
    restartRequired?: boolean;
    restartSupported?: boolean;
    message?: string;
}): ExtensionInstallCompletion {
    if (result.restartRequired === false)
        return { restart: false, message: result.message ?? null };
    if (result.restartSupported === false) {
        return {
            restart: false,
            message:
                result.message ?? "扩展已安装；当前进程不会自动拉起，请手动重启 OneBots 后继续配置",
        };
    }
    return { restart: true, message: null };
}

/** 长安装请求断线后，只接受当前活动操作或本次请求产生的新终态作为恢复证据。 */
export function getExtensionInstallRequestRecovery(
    previousOperationId: string | null,
    extension: Pick<ExtensionInfo, "installation" | "lastInstallation"> | null | undefined,
): ExtensionInstallRequestRecovery {
    if (extension?.installation) return { status: "running" };
    const result = extension?.lastInstallation;
    if (!result || result.operationId === previousOperationId) return { status: "unknown" };
    if (result.status === "succeeded") return { status: "succeeded" };
    return { status: "failed", message: result.message ?? "扩展安装失败" };
}

export function getExtensionInstallationProgress(
    extension: Pick<ExtensionInfo, "installing" | "installation" | "lastInstallation">,
): ExtensionInstallationProgress | null {
    if (extension.installing) {
        const detail = extension.installation
            ? buildInstallationEvidence(
                  extension.installation.operationId,
                  extension.installation.startedAt,
              )
            : null;
        if (extension.installation?.phase === "installing_package") {
            return { variant: "warning", label: "正在安装并核验依赖", detail };
        }
        if (extension.installation?.phase === "preflighting") {
            return { variant: "warning", label: "正在执行隔离预检", detail };
        }
        if (extension.installation?.phase === "restoring_package") {
            return { variant: "warning", label: "正在恢复安装前依赖", detail };
        }
        return { variant: "warning", label: "正在安装扩展", detail };
    }
    if (extension.lastInstallation?.status === "failed") {
        return {
            variant: "danger",
            label: `上次安装失败：${extension.lastInstallation.message ?? "未知错误"}`,
            detail: buildInstallationEvidence(
                extension.lastInstallation.operationId,
                extension.lastInstallation.completedAt,
            ),
        };
    }
    return null;
}

function buildInstallationEvidence(operationId: string, timestamp: string): string {
    return `操作 ${operationId.slice(0, 8)} · ${timestamp}`;
}

export function getExtensionInstallationAction(
    extension: Pick<
        ExtensionInfo,
        | "catalogError"
        | "enabled"
        | "installed"
        | "loaded"
        | "restartSupported"
        | "targetVersion"
        | "versionAligned"
    >,
): ExtensionInstallationAction {
    const restartLabel = extension.restartSupported === false ? "并在完成后手动重启" : "并重启";
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
            label: `安装 v${extension.targetVersion} ${restartLabel}`,
        };
    }
    if (!extension.versionAligned) {
        return {
            visible: true,
            available: true,
            label: `切换至 v${extension.targetVersion} ${restartLabel}`,
        };
    }
    if (!extension.enabled) {
        return {
            visible: true,
            available: true,
            label: extension.restartSupported === false ? "启用并在完成后手动重启" : "启用并重启",
        };
    }
    if (!extension.loaded) {
        return extension.restartSupported === false
            ? { visible: true, available: false, label: "请手动重启以加载" }
            : { visible: true, available: true, label: "重启以加载" };
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
