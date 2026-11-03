import type { GenerationArtifact } from "./installation/generation-plan.js";
import type { ManagerCandidateInstallerOptions } from "./manager-runtime/installer.js";
import type { ServiceScope } from "./service-definition.js";

export interface ManagerUpgradeCandidateRequest {
    id: string;
    scope: ServiceScope;
    expectedPreviousDigest: string;
    archiveSha256: string;
    authorityDirectory?: string;
    artifacts: { host: GenerationArtifact; core: GenerationArtifact; web?: GenerationArtifact };
    archives: {
        host: { bytes: Buffer; sha256: string };
        core: { bytes: Buffer; sha256: string };
        web?: { bytes: Buffer; sha256: string };
    };
}

export interface ManagerUpgradeCandidateDependencies {
    download?: ManagerCandidateInstallerOptions["download"];
}

export interface PreparedManagerUpgradeCandidate {
    operationId: string;
    candidateDirectory: string;
    candidateDigest: string;
    targetVersion: string;
    archiveSha256?: string;
    coreArchiveSha256?: string;
    authorityDirectory?: string;
}

export type ManagerUpgradeCandidateRejectionCode =
    | "INVALID_REQUEST"
    | "SERVICE_METADATA_INVALID"
    | "ACTIVE_CANDIDATE_INVALID"
    | "ARTIFACT_INPUT_INVALID"
    | "CANDIDATE_STORE_INVALID"
    | "OPERATION_CONFLICT"
    | "ARTIFACT_INPUT_FAILED"
    | "CANDIDATE_ALLOCATION_FAILED"
    | "DOWNLOAD_FAILED"
    | "VERIFICATION_FAILED"
    | "CANDIDATE_RECEIPT_INVALID"
    | "CANDIDATE_ENTRY_INVALID"
    | "CANDIDATE_INVALID"
    | "PREFLIGHT_FAILED";
const candidateRejectionCodes = new Set<ManagerUpgradeCandidateRejectionCode>([
    "INVALID_REQUEST",
    "SERVICE_METADATA_INVALID",
    "ACTIVE_CANDIDATE_INVALID",
    "ARTIFACT_INPUT_INVALID",
    "CANDIDATE_STORE_INVALID",
    "OPERATION_CONFLICT",
    "ARTIFACT_INPUT_FAILED",
    "CANDIDATE_ALLOCATION_FAILED",
    "DOWNLOAD_FAILED",
    "VERIFICATION_FAILED",
    "CANDIDATE_RECEIPT_INVALID",
    "CANDIDATE_ENTRY_INVALID",
    "CANDIDATE_INVALID",
    "PREFLIGHT_FAILED",
]);
export class ManagerUpgradeCandidateRejectedError extends Error {
    readonly code: ManagerUpgradeCandidateRejectionCode;
    constructor(code: unknown = "PREFLIGHT_FAILED") {
        super("管理程序升级候选被拒绝，未修改系统服务");
        this.code = candidateRejectionCodes.has(code as ManagerUpgradeCandidateRejectionCode)
            ? (code as ManagerUpgradeCandidateRejectionCode)
            : "PREFLIGHT_FAILED";
    }
}
export class ManagerUpgradeCandidateUnknownError extends Error {}
export const managerUpgradeCandidateFailure = (
    code: ManagerUpgradeCandidateRejectionCode = "PREFLIGHT_FAILED",
) => new ManagerUpgradeCandidateRejectedError(code);
export const managerUpgradeCandidateUnknown = () =>
    new ManagerUpgradeCandidateUnknownError(
        "管理程序候选安装结果尚未确认；保留操作 ID 和工件，禁止重派安装",
    );
