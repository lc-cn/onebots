import type { ServiceProbeResult } from "./utils/service-probes.js";
import {
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";

export interface SystemSnapshotState {
    status: "loading" | "ready" | "unavailable";
    error: string;
}

/** 只在系统管理快照与公开 health 属于同一进程时允许页面展示和触发操作。 */
export function resolveSystemSnapshot(
    systemStatus: "loading" | "ready" | "unavailable",
    systemIdentity: ManagementEvidenceIdentity | null,
    systemError: string,
    health: ServiceProbeResult,
): SystemSnapshotState {
    if (systemStatus === "loading" || (!health.identity && health.state === "warning")) {
        return { status: "loading", error: "" };
    }
    if (systemStatus === "unavailable") {
        return { status: "unavailable", error: systemError || "系统信息请求失败" };
    }
    if (!systemIdentity || !health.identity) {
        return { status: "unavailable", error: health.detail || "health 身份不可用" };
    }
    if (!sameManagementEvidenceIdentity(systemIdentity, health.identity)) {
        return {
            status: "unavailable",
            error: "系统信息与 health 来自不同 OneBots 实例",
        };
    }
    return { status: "ready", error: "" };
}
