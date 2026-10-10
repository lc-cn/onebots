import type {
    ControlExtensionSelection,
    ControlInstallOperation,
    ControlInstallPlan,
} from "@onebots/core/control";
import { createControlOperationId } from "../control-operation-id.js";

export type InstallationTracking = Pick<ControlInstallOperation, "id" | "planDigest"> & {
    planId: string;
    activationRequested?: boolean;
};
export const installationStorageKey = "onebots.control.installation";
export const installationPhaseLabels = {
    queued: "等待安装",
    downloading: "下载依赖",
    verifying: "验证宿主、依赖与扩展",
    verified: "验证通过，尚未应用",
    failed: "安装失败",
    interrupted: "操作中断，需要核查",
};
export function validInstallationSelection(value: unknown): value is ControlExtensionSelection {
    if (!value || typeof value !== "object") return false;
    return ["adapters", "protocols", "applications"].every(key => {
        const items = (value as Record<string, unknown>)[key];
        return Array.isArray(items) && items.every(item => typeof item === "string");
    });
}

export function readInstallationTracking(
    storage: Pick<Storage, "getItem">,
): InstallationTracking | undefined {
    let value: unknown;
    try {
        const text = storage.getItem(installationStorageKey);
        if (text === null) return;
        value = JSON.parse(text);
    } catch {
        throw new Error("无法读取安装记录，请允许浏览器本地存储并核查原操作后刷新。");
    }
    if (!value || typeof value !== "object")
        throw new Error("安装记录已损坏，请核查原操作后修复记录并刷新，暂不允许新安装。");
    const record = value as Record<string, unknown>;
    if (
        typeof record.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(record.id) ||
        typeof record.planId !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.planId) ||
        typeof record.planDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.planDigest) ||
        (record.activationRequested !== undefined &&
            typeof record.activationRequested !== "boolean")
    )
        throw new Error("安装记录已损坏，请核查原操作后修复记录并刷新，暂不允许新安装。");
    return {
        id: record.id,
        planId: record.planId,
        planDigest: record.planDigest,
        activationRequested: record.activationRequested === true,
    };
}

/** 调用方必须持有跨标签页锁；编号先持久化，重试始终复用同一操作。 */
export function persistInstallationTracking(
    storage: Pick<Storage, "getItem" | "setItem">,
    current: InstallationTracking | undefined,
    plan: ControlInstallPlan | undefined,
): InstallationTracking {
    const stored = readInstallationTracking(storage);
    if (current) {
        requireSameTracking(stored, current);
        return stored!;
    }
    if (!plan) throw new Error("请先确认安装计划");
    if (stored) {
        if (stored.planId !== plan.id || stored.planDigest !== plan.planDigest)
            throw new Error("其他页面已有安装操作，请刷新并核查原操作，不会覆盖记录。");
        return stored;
    }
    const next = { id: createControlOperationId(), planId: plan.id, planDigest: plan.planDigest };
    try {
        storage.setItem(installationStorageKey, JSON.stringify(next));
    } catch {
        throw new Error("无法保存操作标识，请允许浏览器本地存储后再安装。");
    }
    return next;
}
function requireSameTracking(
    stored: InstallationTracking | undefined,
    current: InstallationTracking,
) {
    if (
        !stored ||
        stored.id !== current.id ||
        stored.planId !== current.planId ||
        stored.planDigest !== current.planDigest
    )
        throw new Error("安装记录已在其他页面改变，请刷新核查，不会覆盖原操作。");
}
export function persistInstallationActivation(
    storage: Pick<Storage, "getItem" | "setItem">,
    current: InstallationTracking,
): InstallationTracking {
    const stored = readInstallationTracking(storage);
    requireSameTracking(stored, current);
    if (stored!.activationRequested)
        throw new Error("其他页面已请求应用，请核查网关状态，不要重复应用。");
    const next = { ...stored!, activationRequested: true };
    storage.setItem(installationStorageKey, JSON.stringify(next));
    return next;
}
export function clearInstallationTracking(
    storage: Pick<Storage, "getItem" | "removeItem">,
    current: InstallationTracking,
): void {
    const stored = readInstallationTracking(storage);
    requireSameTracking(stored, current);
    if (stored!.activationRequested && !current.activationRequested)
        throw new Error("其他页面已请求应用，请刷新核查，不会清除记录。");
    storage.removeItem(installationStorageKey);
}
export function installationTrackingError(error: unknown): string {
    return error instanceof Error && !(error instanceof DOMException)
        ? error.message
        : "无法保存安装记录，请允许浏览器本地存储后刷新；不会提交新操作。";
}
