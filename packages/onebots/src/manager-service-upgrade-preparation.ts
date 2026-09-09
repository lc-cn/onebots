import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { acquireControlWorkspace } from "./control/workspace.js";
import { bundledPnpmExecutor } from "./installation/bundled-runtime-artifacts.js";
import { freezeGenerationArtifacts } from "./installation/generation-artifacts.js";
import { createGenerationPlan, type GenerationArtifact } from "./installation/generation-plan.js";
import { GenerationStore } from "./installation/generation-store.js";
import { managerCandidateDigest } from "./manager-runtime/identity.js";
import {
    ManagerCandidateInstaller,
    type ManagerCandidateInstallerOptions,
} from "./manager-runtime/installer.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import type { ServiceScope } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import { readServiceMetadata } from "./service-metadata.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";

export interface ManagerUpgradeCandidateRequest {
    id: string;
    scope: ServiceScope;
    expectedPreviousDigest: string;
    archiveSha256: string;
    artifacts: { host: GenerationArtifact; core: GenerationArtifact };
    archives: {
        host: { bytes: Buffer; sha256: string };
        core: { bytes: Buffer; sha256: string };
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
}

export type ManagerUpgradeCandidateRejectionCode =
    | "DOWNLOAD_FAILED"
    | "VERIFICATION_FAILED"
    | "CANDIDATE_INVALID"
    | "PREFLIGHT_FAILED";
const candidateRejectionCodes = new Set<ManagerUpgradeCandidateRejectionCode>([
    "DOWNLOAD_FAILED",
    "VERIFICATION_FAILED",
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
const failure = (code: ManagerUpgradeCandidateRejectionCode = "PREFLIGHT_FAILED") =>
    new ManagerUpgradeCandidateRejectedError(code);
const unknown = () =>
    new ManagerUpgradeCandidateUnknownError(
        "管理程序候选安装结果尚未确认；保留操作 ID 和工件，禁止重派安装",
    );

/**
 * 在独立不可变仓库中准备管理程序候选。意图先于下载持久化；相同操作只查询原安装，
 * 不会因为进程重启或下载结果未知而重新派发 npm/pnpm 外部效果。
 */
export async function prepareManagerUpgradeCandidate(
    request: ManagerUpgradeCandidateRequest,
    host: ServiceHost,
    dependencies: ManagerUpgradeCandidateDependencies = {},
): Promise<PreparedManagerUpgradeCandidate> {
    const value: {
        id: string;
        scope: ServiceScope;
        expectedPreviousDigest: string;
        archiveSha256: string;
        artifacts: unknown;
        archives: unknown;
    } = (() => {
        try {
            const parsed = closedServiceObject(request, [
                "id",
                "scope",
                "expectedPreviousDigest",
                "archiveSha256",
                "artifacts",
                "archives",
            ]);
            if (
                typeof parsed.id !== "string" ||
                !/^[A-Za-z0-9_-]{1,100}$/.test(parsed.id) ||
                (parsed.scope !== "user" && parsed.scope !== "system") ||
                typeof parsed.expectedPreviousDigest !== "string" ||
                !/^[a-f0-9]{64}$/.test(parsed.expectedPreviousDigest) ||
                typeof parsed.archiveSha256 !== "string" ||
                !/^[a-f0-9]{64}$/.test(parsed.archiveSha256) ||
                (host.platform !== "linux" && host.platform !== "darwin") ||
                (parsed.scope === "system" && host.uid !== 0)
            )
                throw failure();
            return {
                id: parsed.id,
                scope: parsed.scope,
                expectedPreviousDigest: parsed.expectedPreviousDigest,
                archiveSha256: parsed.archiveSha256,
                artifacts: parsed.artifacts,
                archives: parsed.archives,
            };
        } catch (error) {
            if (error instanceof ManagerUpgradeCandidateRejectedError) throw error;
            throw failure();
        }
    })();
    const files = getServiceFiles(value.scope, host);
    const metadata = readServiceMetadata(files.metadata);
    if (metadata.kind !== "control" || metadata.spec.scope !== value.scope) throw failure();
    try {
        verifyManagerServiceCandidate(metadata.spec, value.expectedPreviousDigest);
    } catch {
        throw failure();
    }
    let artifacts: Record<string, unknown>;
    let archives: Record<string, unknown>;
    try {
        artifacts = closedServiceObject(value.artifacts, ["host", "core"]);
        archives = closedServiceObject(value.archives, ["host", "core"]);
    } catch {
        throw failure();
    }
    const artifact = (input: unknown, name: "onebots" | "@onebots/core") => {
        const item = closedServiceObject(input, ["name", "version", "spec"]);
        if (item.name !== name || typeof item.version !== "string" || typeof item.spec !== "string")
            throw failure();
        return { name, version: item.version, spec: item.spec };
    };
    const home = path.join(files.stateDir, "manager-artifacts");
    let release: () => void;
    try {
        privateDirectory(files.stateDir, false);
        privateDirectory(home);
        release = acquireControlWorkspace(home);
    } catch {
        throw failure();
    }
    let installer: ManagerCandidateInstaller | undefined;
    let installationOutcomeUncertain = false;
    try {
        const upgrades = path.join(home, "upgrades");
        privateDirectory(upgrades);
        const directory = path.join(upgrades, value.id);
        privateDirectory(directory);
        const binding = new ServiceOperationStorage(directory);
        const resolvedArtifacts = path.join(home, "resolved-artifacts");
        privateDirectory(resolvedArtifacts);
        const hostArchive = materializeArchive(archives.host, resolvedArtifacts);
        const coreArchive = materializeArchive(archives.core, resolvedArtifacts);
        if (hostArchive.sha256 !== value.archiveSha256) throw failure();
        const hostArtifact = artifact(artifacts.host, "onebots");
        const coreArtifact = artifact(artifacts.core, "@onebots/core");
        const frozen = await freezeGenerationArtifacts(
            {
                host: {
                    ...hostArtifact,
                    spec: `file:${hostArchive.file}`,
                    sha256: hostArchive.sha256,
                },
                core: {
                    ...coreArtifact,
                    spec: `file:${coreArchive.file}`,
                    sha256: coreArchive.sha256,
                },
            },
            path.join(home, "artifacts"),
        );
        const plan = createGenerationPlan({
            host: frozen.host,
            core: frozen.core,
            extensions: [],
            selection: { adapters: [], protocols: [], applications: [] },
        });
        const installationId = `upgrade-${value.id}`;
        const intent = {
            schemaVersion: 1,
            id: value.id,
            installationId,
            scope: value.scope,
            expectedPreviousDigest: value.expectedPreviousDigest,
            archiveSha256: value.archiveSha256,
            coreArchiveSha256: coreArchive.sha256,
            planDigest: plan.digest,
            targetVersion: plan.host.version,
        };
        const existing = binding.has("intent.json");
        if (existing) {
            if (!isDeepStrictEqual(binding.read("intent.json"), intent)) throw failure();
        } else {
            if (
                binding.has("candidate.json") ||
                fs.existsSync(path.join(home, "operations", `${installationId}.json`))
            )
                throw failure();
            binding.write("intent.json", intent, true);
        }
        installer = new ManagerCandidateInstaller({
            operationsDirectory: path.join(home, "operations"),
            store: new GenerationStore({
                root: path.join(home, "versions"),
                isActive: candidateId => {
                    if (!binding.has("candidate.json")) return false;
                    const receipt = closedServiceObject(binding.read("candidate.json"), [
                        "schemaVersion",
                        "id",
                        "planDigest",
                        "candidateId",
                        "candidateDigest",
                        "targetVersion",
                    ]);
                    if (typeof receipt.candidateId !== "string") throw failure();
                    return receipt.candidateId === candidateId;
                },
            }),
            ...bundledPnpmExecutor(),
            ...(dependencies.download ? { download: dependencies.download } : {}),
        });
        installationOutcomeUncertain = true;
        const installed = existing
            ? installer.status(installationId)
            : await installer.install(installationId, plan);
        installationOutcomeUncertain = false;
        if (["interrupted", "downloading", "verifying"].includes(installed.phase)) throw unknown();
        if (installed.phase === "failed")
            throw failure(
                installed.error === "DOWNLOAD_FAILED"
                    ? "DOWNLOAD_FAILED"
                    : installed.error === "VERIFICATION_FAILED"
                      ? "VERIFICATION_FAILED"
                      : "CANDIDATE_INVALID",
            );
        if (
            installed.phase !== "verified" ||
            installed.planDigest !== plan.digest ||
            !installed.candidateId
        )
            throw failure();
        const candidate = installer.readCandidate(installed.candidateId);
        if (candidate.operationId !== installationId || candidate.planDigest !== plan.digest)
            throw failure();
        const candidateDigest = managerCandidateDigest(candidate);
        const binPath = path.join(candidate.directory, "node_modules/onebots/lib/bin.js");
        verifyManagerServiceCandidate(
            {
                ...metadata.spec,
                workingDirectory: candidate.directory,
                binPath,
            },
            candidateDigest,
        );
        const receipt = {
            schemaVersion: 1,
            id: value.id,
            planDigest: plan.digest,
            candidateId: candidate.id,
            candidateDigest,
            targetVersion: plan.host.version,
        };
        if (binding.has("candidate.json")) {
            if (!isDeepStrictEqual(binding.read("candidate.json"), receipt)) throw failure();
        } else binding.write("candidate.json", receipt, true);
        return {
            operationId: value.id,
            candidateDirectory: candidate.directory,
            candidateDigest,
            targetVersion: plan.host.version,
        };
    } catch (error) {
        if (
            error instanceof ManagerUpgradeCandidateRejectedError ||
            error instanceof ManagerUpgradeCandidateUnknownError
        )
            throw error;
        if (installationOutcomeUncertain) throw unknown();
        throw failure();
    } finally {
        try {
            await installer?.close();
        } finally {
            release();
        }
    }
}

/** 断网恢复只读取原意图、安装操作与已验证收据；不解析发布源、不写回缺失确认。 */
export async function resumeManagerUpgradeCandidate(
    id: string,
    scope: ServiceScope,
    expectedPreviousDigest: string,
    host: ServiceHost,
    expectedVersion?: string,
): Promise<PreparedManagerUpgradeCandidate> {
    if (
        !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
        (scope !== "user" && scope !== "system") ||
        !/^[a-f0-9]{64}$/.test(expectedPreviousDigest) ||
        (host.platform !== "linux" && host.platform !== "darwin") ||
        (scope === "system" && host.uid !== 0)
    )
        throw failure();
    const files = getServiceFiles(scope, host);
    const metadata = readServiceMetadata(files.metadata);
    if (metadata.kind !== "control" || metadata.spec.scope !== scope) throw failure();
    try {
        verifyManagerServiceCandidate(metadata.spec, expectedPreviousDigest);
    } catch {
        throw failure();
    }
    const home = path.join(files.stateDir, "manager-artifacts");
    let release: () => void;
    try {
        privateDirectory(files.stateDir, false);
        privateDirectory(home, false);
        release = acquireControlWorkspace(home);
    } catch {
        throw failure();
    }
    let installer: ManagerCandidateInstaller | undefined;
    let querying = false;
    try {
        const binding = new ServiceOperationStorage(path.join(home, "upgrades", id));
        const intent = closedServiceObject(binding.read("intent.json"), [
            "schemaVersion",
            "id",
            "installationId",
            "scope",
            "expectedPreviousDigest",
            "archiveSha256",
            "coreArchiveSha256",
            "planDigest",
            "targetVersion",
        ]);
        if (
            intent.schemaVersion !== 1 ||
            intent.id !== id ||
            intent.installationId !== `upgrade-${id}` ||
            intent.scope !== scope ||
            intent.expectedPreviousDigest !== expectedPreviousDigest ||
            typeof intent.archiveSha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(intent.archiveSha256) ||
            typeof intent.coreArchiveSha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(intent.coreArchiveSha256) ||
            typeof intent.planDigest !== "string" ||
            !/^[a-f0-9]{64}$/.test(intent.planDigest) ||
            typeof intent.targetVersion !== "string" ||
            (expectedVersion !== undefined && intent.targetVersion !== expectedVersion)
        )
            throw failure();
        installer = new ManagerCandidateInstaller({
            operationsDirectory: path.join(home, "operations"),
            store: new GenerationStore({ root: path.join(home, "versions"), isActive: () => true }),
            ...bundledPnpmExecutor(),
        });
        querying = true;
        const operation = installer.status(intent.installationId);
        querying = false;
        if (["interrupted", "downloading", "verifying"].includes(operation.phase)) throw unknown();
        if (operation.phase === "failed") throw failure();
        if (
            operation.phase !== "verified" ||
            operation.planDigest !== intent.planDigest ||
            !operation.candidateId
        )
            throw failure();
        const candidate = installer.readCandidate(operation.candidateId);
        if (
            candidate.operationId !== intent.installationId ||
            candidate.planDigest !== intent.planDigest ||
            candidate.receipt.hostVersion !== intent.targetVersion
        )
            throw failure();
        const candidateDigest = managerCandidateDigest(candidate);
        if (binding.has("candidate.json")) {
            const receipt = closedServiceObject(binding.read("candidate.json"), [
                "schemaVersion",
                "id",
                "planDigest",
                "candidateId",
                "candidateDigest",
                "targetVersion",
            ]);
            if (
                receipt.schemaVersion !== 1 ||
                receipt.id !== id ||
                receipt.planDigest !== intent.planDigest ||
                receipt.candidateId !== candidate.id ||
                receipt.candidateDigest !== candidateDigest ||
                receipt.targetVersion !== intent.targetVersion
            )
                throw failure();
        }
        verifyManagerServiceCandidate(
            {
                ...metadata.spec,
                workingDirectory: candidate.directory,
                binPath: path.join(candidate.directory, "node_modules/onebots/lib/bin.js"),
            },
            candidateDigest,
        );
        return {
            operationId: id,
            candidateDirectory: candidate.directory,
            candidateDigest,
            targetVersion: intent.targetVersion,
            archiveSha256: intent.archiveSha256,
            coreArchiveSha256: intent.coreArchiveSha256,
        };
    } catch (error) {
        if (
            error instanceof ManagerUpgradeCandidateRejectedError ||
            error instanceof ManagerUpgradeCandidateUnknownError
        )
            throw error;
        if (querying) throw unknown();
        throw failure();
    } finally {
        try {
            await installer?.close();
        } finally {
            release();
        }
    }
}

function materializeArchive(input: unknown, directory: string): { file: string; sha256: string } {
    const value = closedServiceObject(input, ["bytes", "sha256"]);
    if (
        !Buffer.isBuffer(value.bytes) ||
        value.bytes.length === 0 ||
        value.bytes.length > 32 * 1024 * 1024 ||
        typeof value.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.sha256) ||
        createHash("sha256").update(value.bytes).digest("hex") !== value.sha256
    )
        throw failure();
    const file = path.join(directory, `${value.sha256}.tgz`);
    if (fs.existsSync(file)) {
        const stat = fs.lstatSync(file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.size === 0 ||
            stat.size > 32 * 1024 * 1024 ||
            (stat.mode & 0o7777) !== 0o400 ||
            (process.getuid && stat.uid !== process.getuid()) ||
            createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== value.sha256
        )
            throw failure();
        return { file: fs.realpathSync(file), sha256: value.sha256 };
    }
    const temporary = path.join(directory, `.${value.sha256}.${randomUUID()}.tmp`);
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, value.bytes);
            fs.fchmodSync(descriptor, 0o400);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, file);
        const folder = fs.openSync(directory, "r");
        try {
            fs.fsyncSync(folder);
        } finally {
            fs.closeSync(folder);
        }
        return { file: fs.realpathSync(file), sha256: value.sha256 };
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function privateDirectory(directory: string, create = true): void {
    if (create && !fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        fs.realpathSync(directory) !== directory ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o700)
    )
        throw failure();
}
