import fs from "node:fs";
import { upgradeServiceAuthority } from "./service-authority.js";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { acquireControlWorkspace } from "./control/workspace.js";
import { bundledPnpmExecutor } from "./installation/bundled-runtime-artifacts.js";
import { freezeGenerationArtifacts } from "./installation/generation-artifacts.js";
import { createGenerationPlan } from "./installation/generation-plan.js";
import { GenerationStore } from "./installation/generation-store.js";
import { managerCandidateDigest } from "./manager-runtime/identity.js";
import { ManagerCandidateInstaller } from "./manager-runtime/installer.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import {
    ensurePrivateManagerUpgradeDirectory,
    ManagerUpgradeArtifactStoreError,
    materializeManagerUpgradeArchive,
} from "./manager-service-upgrade-artifact-store.js";
import type { ServiceScope } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import { readServiceMetadata } from "./service-metadata.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import {
    secureWindowsServiceDirectory,
    secureWindowsServiceFile,
} from "./windows-service-security.js";

import {
    managerUpgradeCandidateFailure as failure,
    managerUpgradeCandidateUnknown as unknown,
    ManagerUpgradeCandidateRejectedError,
    ManagerUpgradeCandidateUnknownError,
    type ManagerUpgradeCandidateRequest,
    type ManagerUpgradeCandidateDependencies,
    type PreparedManagerUpgradeCandidate,
    type ManagerUpgradeCandidateRejectionCode,
} from "./manager-service-upgrade-candidate-contract.js";
export {
    ManagerUpgradeCandidateRejectedError,
    ManagerUpgradeCandidateUnknownError,
} from "./manager-service-upgrade-candidate-contract.js";
export type {
    ManagerUpgradeCandidateRequest,
    ManagerUpgradeCandidateDependencies,
    PreparedManagerUpgradeCandidate,
    ManagerUpgradeCandidateRejectionCode,
} from "./manager-service-upgrade-candidate-contract.js";
export { resumeManagerUpgradeCandidate } from "./manager-service-upgrade-resume.js";

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
        authorityDirectory?: string;
    } = (() => {
        try {
            const parsed = closedServiceObject(request, [
                "id",
                "scope",
                "expectedPreviousDigest",
                "archiveSha256",
                "artifacts",
                "archives",
                ...(Object.hasOwn(request, "authorityDirectory") ? ["authorityDirectory"] : []),
            ]);
            if (
                typeof parsed.id !== "string" ||
                !/^[A-Za-z0-9_-]{1,100}$/.test(parsed.id) ||
                (parsed.scope !== "user" && parsed.scope !== "system") ||
                typeof parsed.expectedPreviousDigest !== "string" ||
                !/^[a-f0-9]{64}$/.test(parsed.expectedPreviousDigest) ||
                typeof parsed.archiveSha256 !== "string" ||
                (parsed.authorityDirectory !== undefined &&
                    (typeof parsed.authorityDirectory !== "string" ||
                        !path.isAbsolute(parsed.authorityDirectory))) ||
                !/^[a-f0-9]{64}$/.test(parsed.archiveSha256) ||
                !["linux", "darwin", "win32"].includes(host.platform) ||
                (host.platform === "win32"
                    ? parsed.scope !== "system" || host.isElevated !== true
                    : parsed.scope === "system" && host.uid !== 0)
            )
                throw failure("INVALID_REQUEST");
            return {
                id: parsed.id,
                scope: parsed.scope,
                expectedPreviousDigest: parsed.expectedPreviousDigest,
                archiveSha256: parsed.archiveSha256,
                artifacts: parsed.artifacts,
                archives: parsed.archives,
                ...(typeof parsed.authorityDirectory === "string"
                    ? { authorityDirectory: parsed.authorityDirectory }
                    : {}),
            };
        } catch (error) {
            if (error instanceof ManagerUpgradeCandidateRejectedError) throw error;
            throw failure("INVALID_REQUEST");
        }
    })();
    const files = getServiceFiles(value.scope, host);
    let metadata: ReturnType<typeof readServiceMetadata>;
    try {
        metadata = readServiceMetadata(files.metadata);
    } catch {
        throw failure("SERVICE_METADATA_INVALID");
    }
    if (metadata.kind !== "control" || metadata.spec.scope !== value.scope)
        throw failure("SERVICE_METADATA_INVALID");
    const targetTemplate = upgradeServiceAuthority(metadata.spec, host, value.authorityDirectory);
    try {
        verifyManagerServiceCandidate(metadata.spec, value.expectedPreviousDigest);
    } catch {
        throw failure("ACTIVE_CANDIDATE_INVALID");
    }
    let artifacts: Record<string, unknown>;
    let archives: Record<string, unknown>;
    try {
        const keys =
            value.artifacts &&
            typeof value.artifacts === "object" &&
            Object.hasOwn(value.artifacts, "web")
                ? ["host", "core", "web"]
                : ["host", "core"];
        artifacts = closedServiceObject(value.artifacts, keys);
        archives = closedServiceObject(value.archives, keys);
        if ((artifacts.web === undefined) !== (archives.web === undefined))
            throw failure("ARTIFACT_INPUT_INVALID");
    } catch {
        throw failure("ARTIFACT_INPUT_INVALID");
    }
    const artifact = (input: unknown, name: "onebots" | "@onebots/core" | "@onebots/web") => {
        const item = closedServiceObject(input, ["name", "version", "spec"]);
        if (item.name !== name || typeof item.version !== "string" || typeof item.spec !== "string")
            throw failure("ARTIFACT_INPUT_INVALID");
        return { name, version: item.version, spec: item.spec };
    };
    const home = path.join(files.stateDir, "manager-artifacts");
    let release: () => void;
    try {
        ensurePrivateManagerUpgradeDirectory(files.stateDir, false, host);
        ensurePrivateManagerUpgradeDirectory(home, true, host);
        release = acquireControlWorkspace(home, host);
    } catch {
        throw failure("CANDIDATE_STORE_INVALID");
    }
    let installer: ManagerCandidateInstaller | undefined;
    let installationOutcomeUncertain = false;
    let rejectionCode: ManagerUpgradeCandidateRejectionCode = "CANDIDATE_STORE_INVALID";
    try {
        const upgrades = path.join(home, "upgrades");
        ensurePrivateManagerUpgradeDirectory(upgrades, true, host);
        const directory = path.join(upgrades, value.id);
        ensurePrivateManagerUpgradeDirectory(directory, true, host);
        const binding = new ServiceOperationStorage(directory);
        const resolvedArtifacts = path.join(home, "resolved-artifacts");
        ensurePrivateManagerUpgradeDirectory(resolvedArtifacts, true, host);
        rejectionCode = "ARTIFACT_INPUT_INVALID";
        const hostArchive = materializeManagerUpgradeArchive(
            archives.host,
            resolvedArtifacts,
            host,
        );
        const coreArchive = materializeManagerUpgradeArchive(
            archives.core,
            resolvedArtifacts,
            host,
        );
        if (hostArchive.sha256 !== value.archiveSha256) throw failure("ARTIFACT_INPUT_INVALID");
        const hostArtifact = artifact(artifacts.host, "onebots");
        const coreArtifact = artifact(artifacts.core, "@onebots/core");
        const webArchive =
            archives.web === undefined
                ? undefined
                : materializeManagerUpgradeArchive(archives.web, resolvedArtifacts, host);
        const webArtifact =
            artifacts.web === undefined ? undefined : artifact(artifacts.web, "@onebots/web");
        ensurePrivateManagerUpgradeDirectory(path.join(home, "artifacts"), true, host);
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
                ...(webArtifact && webArchive
                    ? {
                          web: {
                              ...webArtifact,
                              spec: `file:${webArchive.file}`,
                              sha256: webArchive.sha256,
                          },
                      }
                    : {}),
            },
            path.join(home, "artifacts"),
        );
        const plan = createGenerationPlan({
            host: frozen.host,
            core: frozen.core,
            web: frozen.web,
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
            authorityDirectory: targetTemplate.authorityDirectory,
        };
        const existing = binding.has("intent.json");
        rejectionCode = "OPERATION_CONFLICT";
        if (existing) {
            if (!isDeepStrictEqual(binding.read("intent.json"), intent))
                throw failure("OPERATION_CONFLICT");
        } else {
            if (
                binding.has("candidate.json") ||
                fs.existsSync(path.join(home, "operations", `${installationId}.json`))
            )
                throw failure("OPERATION_CONFLICT");
            binding.write("intent.json", intent, true);
            if (host.platform === "win32")
                secureWindowsServiceFile(host, path.join(directory, "intent.json"));
        }
        ensurePrivateManagerUpgradeDirectory(path.join(home, "operations"), true, host);
        ensurePrivateManagerUpgradeDirectory(path.join(home, "versions"), true, host);
        installer = new ManagerCandidateInstaller({
            operationsDirectory: path.join(home, "operations"),
            store: new GenerationStore({
                root: path.join(home, "versions"),
                ...(host.platform === "win32"
                    ? {
                          createCandidateDirectory: (candidateDirectory: string) =>
                              secureWindowsServiceDirectory(host, candidateDirectory),
                      }
                    : {}),
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
                installed.error === "ARTIFACT_INPUT_FAILED" ||
                    installed.error === "CANDIDATE_ALLOCATION_FAILED" ||
                    installed.error === "DOWNLOAD_FAILED"
                    ? installed.error
                    : installed.error === "VERIFICATION_FAILED"
                      ? "VERIFICATION_FAILED"
                      : "CANDIDATE_INVALID",
            );
        if (
            installed.phase !== "verified" ||
            installed.planDigest !== plan.digest ||
            !installed.candidateId
        )
            throw failure("CANDIDATE_RECEIPT_INVALID");
        rejectionCode = "CANDIDATE_RECEIPT_INVALID";
        const candidate = installer.readCandidate(installed.candidateId);
        if (candidate.operationId !== installationId || candidate.planDigest !== plan.digest)
            throw failure("CANDIDATE_RECEIPT_INVALID");
        const candidateDigest = managerCandidateDigest(candidate);
        const binPath = path.join(candidate.directory, "node_modules/onebots/lib/bin.js");
        rejectionCode = "CANDIDATE_ENTRY_INVALID";
        try {
            verifyManagerServiceCandidate(
                {
                    ...targetTemplate,
                    workingDirectory: candidate.directory,
                    binPath,
                },
                candidateDigest,
            );
        } catch {
            throw failure("CANDIDATE_ENTRY_INVALID");
        }
        const receipt = {
            schemaVersion: 1,
            id: value.id,
            planDigest: plan.digest,
            candidateId: candidate.id,
            candidateDigest,
            targetVersion: plan.host.version,
        };
        rejectionCode = "OPERATION_CONFLICT";
        if (binding.has("candidate.json")) {
            if (!isDeepStrictEqual(binding.read("candidate.json"), receipt))
                throw failure("OPERATION_CONFLICT");
        } else {
            binding.write("candidate.json", receipt, true);
            if (host.platform === "win32")
                secureWindowsServiceFile(host, path.join(directory, "candidate.json"));
        }
        return {
            operationId: value.id,
            candidateDirectory: candidate.directory,
            candidateDigest,
            targetVersion: plan.host.version,
            authorityDirectory: targetTemplate.authorityDirectory,
        };
    } catch (error) {
        if (error instanceof ManagerUpgradeArtifactStoreError) throw failure();
        if (
            error instanceof ManagerUpgradeCandidateRejectedError ||
            error instanceof ManagerUpgradeCandidateUnknownError
        )
            throw error;
        if (installationOutcomeUncertain) throw unknown();
        throw failure(rejectionCode);
    } finally {
        try {
            await installer?.close();
        } finally {
            release();
        }
    }
}
