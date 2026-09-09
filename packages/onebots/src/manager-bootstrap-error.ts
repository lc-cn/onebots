import type { GenerationInstallOperation } from "./installation/generation-installer.js";

export type ManagerBootstrapCandidateErrorCode =
    | NonNullable<GenerationInstallOperation["error"]>
    | "CANDIDATE_READ_FAILED"
    | "CANDIDATE_SECURITY_FAILED"
    | "CANDIDATE_IDENTITY_FAILED"
    | "CANDIDATE_BINDING_FAILED";

export class ManagerBootstrapCandidateError extends Error {
    constructor(
        readonly operationId: string,
        readonly phase: GenerationInstallOperation["phase"],
        readonly code: ManagerBootstrapCandidateErrorCode,
    ) {
        super("管理服务候选准备未完成");
        this.name = "ManagerBootstrapCandidateError";
    }
}
