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
    const value: unknown = JSON.parse(storage.getItem(installationStorageKey) ?? "null");
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (
        typeof record.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(record.id) ||
        typeof record.planId !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.planId) ||
        typeof record.planDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.planDigest)
    )
        return;
    return {
        id: record.id,
        planId: record.planId,
        planDigest: record.planDigest,
        activationRequested: record.activationRequested === true,
    };
}

/** 提交前必须持久化编号；重试始终复用同一操作，不存放私有仓库凭据。 */
export function persistInstallationTracking(
    storage: Pick<Storage, "setItem">,
    current: InstallationTracking | undefined,
    plan: ControlInstallPlan | undefined,
): InstallationTracking {
    if (!current && !plan) throw new Error("请先确认安装计划");
    const next = current ?? {
        id: createControlOperationId(),
        planId: plan!.id,
        planDigest: plan!.planDigest,
    };
    try {
        storage.setItem(installationStorageKey, JSON.stringify(next));
    } catch {
        throw new Error("无法保存操作标识，请允许浏览器本地存储后再安装。");
    }
    return next;
}
