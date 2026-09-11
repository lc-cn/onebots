import fs from "node:fs";
import path from "node:path";
import type { GenerationInstallOperation } from "./installation/generation-installer.js";
import { parseManagerServiceRecord, type ManagerServicePhase } from "./manager-service-journal.js";
import type { WindowsServiceSecurityStage } from "./windows-service-security.js";

export type ManagerBootstrapCandidateErrorCode =
    | NonNullable<GenerationInstallOperation["error"]>
    | "CANDIDATE_READ_FAILED"
    | "CANDIDATE_SECURITY_FAILED"
    | "CANDIDATE_IDENTITY_FAILED"
    | "CANDIDATE_BINDING_FAILED";

export type ManagerBootstrapPhase =
    | "candidate-preparation"
    | `candidate-${GenerationInstallOperation["phase"]}`
    | "candidate-read"
    | "candidate-security"
    | "candidate-identity"
    | "candidate-binding"
    | "manager-preflight"
    | "manager-journal"
    | `manager-${ManagerServicePhase}`;

export type ManagerBootstrapErrorCode =
    | ManagerBootstrapCandidateErrorCode
    | "CANDIDATE_PREPARATION_FAILED"
    | "MANAGER_PREFLIGHT_FAILED"
    | "MANAGER_JOURNAL_FAILED"
    | "MANAGER_CLEANUP_FAILED";

export type ManagerBootstrapSetupPhase =
    | "windows-identity"
    | "windows-state-security"
    | "windows-workspace-security"
    | "service-lock"
    | "bootstrap-cycle";

export type ManagerBootstrapSetupErrorCode =
    | "WINDOWS_IDENTITY_UNAVAILABLE"
    | "WINDOWS_STATE_ACL_FAILED"
    | "WINDOWS_WORKSPACE_ACL_FAILED"
    | "SERVICE_LOCK_FAILED"
    | "BOOTSTRAP_CYCLE_FAILED";

/** operationId 产生前的闭合诊断；不携带原始异常、路径或 SID。 */
export class ManagerBootstrapSetupError extends Error {
    constructor(
        readonly bootstrapPhase: ManagerBootstrapSetupPhase,
        readonly code: ManagerBootstrapSetupErrorCode,
        readonly securityStage?: WindowsServiceSecurityStage,
    ) {
        super("管理服务首次安装前置检查未完成");
        this.name = "ManagerBootstrapSetupError";
    }
}

export class ManagerBootstrapStageError extends Error {
    constructor(
        readonly operationId: string,
        readonly bootstrapPhase: ManagerBootstrapPhase,
        readonly code: ManagerBootstrapErrorCode,
    ) {
        super("管理服务首次安装未完成");
        this.name = "ManagerBootstrapStageError";
    }
}

/** 仅读取当前稳定 ID 的 manager journal；拒绝链接、超限或不闭合记录。 */
export function deriveManagerBootstrapStageError(
    stateDirectory: string,
    operationId: string,
    bootstrapPhase: ManagerBootstrapPhase,
): ManagerBootstrapStageError {
    const journal = readStableJson(
        path.join(stateDirectory, "manager-operations", `${operationId}.json`),
    );
    if (journal.exists) {
        try {
            const record = parseManagerServiceRecord(journal.value);
            if (record.id !== operationId || record.action !== "install") throw new Error();
            return new ManagerBootstrapStageError(
                operationId,
                `manager-${record.phase}`,
                "MANAGER_JOURNAL_FAILED",
            );
        } catch {
            return new ManagerBootstrapStageError(
                operationId,
                "manager-journal",
                "MANAGER_JOURNAL_FAILED",
            );
        }
    }
    if (bootstrapPhase.startsWith("manager-"))
        return new ManagerBootstrapStageError(
            operationId,
            bootstrapPhase,
            "MANAGER_PREFLIGHT_FAILED",
        );
    const home = path.join(stateDirectory, "manager-artifacts");
    const operation = readStableJson(path.join(home, "operations", `${operationId}.json`));
    if (operation.exists) {
        const evidence = generationOperation(operation.value, operationId);
        if (evidence)
            return new ManagerBootstrapStageError(
                operationId,
                `candidate-${evidence.phase}`,
                evidence.error ??
                    (evidence.phase === "verified"
                        ? "CANDIDATE_BINDING_FAILED"
                        : "CANDIDATE_PREPARATION_FAILED"),
            );
    }
    return new ManagerBootstrapStageError(
        operationId,
        bootstrapPhase,
        bootstrapPhase.startsWith("candidate-")
            ? "CANDIDATE_PREPARATION_FAILED"
            : "MANAGER_PREFLIGHT_FAILED",
    );
}

function generationOperation(
    input: unknown,
    id: string,
): Pick<GenerationInstallOperation, "phase" | "error"> | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const value = input as Record<string, unknown>;
    const allowed = [
        "schemaVersion",
        "id",
        "planDigest",
        "phase",
        "candidateId",
        "createdAt",
        "finishedAt",
        "error",
    ];
    if (
        Reflect.ownKeys(value).some(key => typeof key !== "string" || !allowed.includes(key)) ||
        value.schemaVersion !== 1 ||
        value.id !== id ||
        typeof value.planDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.planDigest) ||
        typeof value.phase !== "string" ||
        !["queued", "downloading", "verifying", "verified", "failed", "interrupted"].includes(
            value.phase,
        ) ||
        typeof value.createdAt !== "string" ||
        !Number.isFinite(Date.parse(value.createdAt)) ||
        (value.candidateId !== undefined &&
            (typeof value.candidateId !== "string" ||
                !/^[a-f0-9-]{36}$/.test(value.candidateId))) ||
        (value.finishedAt !== undefined &&
            (typeof value.finishedAt !== "string" ||
                !Number.isFinite(Date.parse(value.finishedAt)))) ||
        (value.error !== undefined &&
            ![
                "ARTIFACT_INPUT_FAILED",
                "CANDIDATE_ALLOCATION_FAILED",
                "DOWNLOAD_FAILED",
                "VERIFICATION_FAILED",
                "INTERRUPTED",
            ].includes(String(value.error)))
    )
        return null;
    return {
        phase: value.phase as GenerationInstallOperation["phase"],
        ...(value.error
            ? { error: value.error as NonNullable<GenerationInstallOperation["error"]> }
            : {}),
    };
}

function readStableJson(file: string): { exists: boolean; value?: unknown } {
    let descriptor: number | undefined;
    try {
        const stat = fs.lstatSync(file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.size === 0 ||
            stat.size > 32_768
        )
            return { exists: true };
        descriptor = fs.openSync(
            file,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
        );
        const before = fs.fstatSync(descriptor);
        const content = Buffer.alloc(stat.size);
        const count = fs.readSync(descriptor, content, 0, content.length, 0);
        const after = fs.fstatSync(descriptor);
        const current = fs.lstatSync(file);
        if (
            before.dev !== stat.dev ||
            before.ino !== stat.ino ||
            before.size !== stat.size ||
            count !== stat.size ||
            after.ctimeMs !== before.ctimeMs ||
            after.mtimeMs !== before.mtimeMs ||
            current.dev !== before.dev ||
            current.ino !== before.ino ||
            current.nlink !== 1
        )
            return { exists: true };
        return {
            exists: true,
            value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)),
        };
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT"
            ? { exists: false }
            : { exists: true };
    } finally {
        if (descriptor !== undefined) {
            try {
                fs.closeSync(descriptor);
            } catch {
                // 只读诊断不能因关闭结果未知而覆盖原安装错误。
            }
        }
    }
}

export class ManagerBootstrapCandidateError extends Error {
    constructor(
        readonly operationId: string,
        readonly phase: GenerationInstallOperation["phase"],
        readonly code: ManagerBootstrapCandidateErrorCode,
        readonly securityStage?: WindowsServiceSecurityStage,
    ) {
        super("管理服务候选准备未完成");
        this.name = "ManagerBootstrapCandidateError";
    }
}
