import type { GenerationInstallOperation } from "./installation/generation-installer.js";

export class ManagerBootstrapCandidateError extends Error {
    constructor(
        readonly operationId: string,
        readonly phase: GenerationInstallOperation["phase"],
        readonly code: NonNullable<GenerationInstallOperation["error"]>,
    ) {
        super("管理服务候选准备未完成");
        this.name = "ManagerBootstrapCandidateError";
    }
}
