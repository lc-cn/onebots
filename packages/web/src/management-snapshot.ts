import {
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";

export type ManagementSnapshotStatus = "loading" | "ready" | "unavailable";

interface ManagementSnapshotInput {
    adapterStatus: ManagementSnapshotStatus;
    adapterIdentity: ManagementEvidenceIdentity | null;
    adapterError: string;
    capabilityStatus: ManagementSnapshotStatus;
    capabilityIdentity: ManagementEvidenceIdentity | null;
    capabilityError: string;
}

export interface ManagementSnapshotState {
    status: ManagementSnapshotStatus;
    error: string;
}

/** 只有账号运行态与能力目录来自同一进程时，页面才能采用并操作账号快照。 */
export function resolveManagementSnapshot(input: ManagementSnapshotInput): ManagementSnapshotState {
    if (input.adapterStatus === "loading" || input.capabilityStatus === "loading") {
        return { status: "loading", error: "" };
    }
    if (input.adapterStatus === "unavailable") {
        return { status: "unavailable", error: input.adapterError || "账号运行态请求失败" };
    }
    if (input.capabilityStatus === "unavailable") {
        return { status: "unavailable", error: input.capabilityError || "能力清单请求失败" };
    }
    if (
        !input.adapterIdentity ||
        !input.capabilityIdentity ||
        !sameManagementEvidenceIdentity(input.adapterIdentity, input.capabilityIdentity)
    ) {
        return {
            status: "unavailable",
            error: "账号运行态与能力目录来自不同 OneBots 实例",
        };
    }
    return { status: "ready", error: input.capabilityError };
}
