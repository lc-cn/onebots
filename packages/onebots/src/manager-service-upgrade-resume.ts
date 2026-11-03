import path from "node:path";
import type { ServiceScope } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
import { readServiceMetadata } from "./service-metadata.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { upgradeServiceAuthority } from "./service-authority.js";
import { ensurePrivateManagerUpgradeDirectory } from "./manager-service-upgrade-artifact-store.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import { ManagerCandidateInstaller } from "./manager-runtime/installer.js";
import { GenerationStore } from "./installation/generation-store.js";
import { bundledPnpmExecutor } from "./installation/bundled-runtime-artifacts.js";
import { managerCandidateDigest } from "./manager-runtime/identity.js";
import {
    managerUpgradeCandidateFailure as failure,
    managerUpgradeCandidateUnknown as unknown,
    ManagerUpgradeCandidateRejectedError,
    ManagerUpgradeCandidateUnknownError,
    type PreparedManagerUpgradeCandidate,
} from "./manager-service-upgrade-candidate-contract.js";

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
        !["linux", "darwin", "win32"].includes(host.platform) ||
        (host.platform === "win32"
            ? scope !== "system" || host.isElevated !== true
            : scope === "system" && host.uid !== 0)
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
        ensurePrivateManagerUpgradeDirectory(files.stateDir, false, host);
        ensurePrivateManagerUpgradeDirectory(home, false, host);
        release = acquireControlWorkspace(home, host);
    } catch {
        throw failure();
    }
    let installer: ManagerCandidateInstaller | undefined;
    let querying = false;
    try {
        const upgrades = path.join(home, "upgrades");
        const bindingDirectory = path.join(upgrades, id);
        for (const directory of [
            upgrades,
            bindingDirectory,
            path.join(home, "operations"),
            path.join(home, "versions"),
        ])
            ensurePrivateManagerUpgradeDirectory(directory, false, host);
        const binding = new ServiceOperationStorage(bindingDirectory);
        const rawIntent = binding.read("intent.json");
        const intent = closedServiceObject(rawIntent, [
            "schemaVersion",
            "id",
            "installationId",
            "scope",
            "expectedPreviousDigest",
            "archiveSha256",
            "coreArchiveSha256",
            "planDigest",
            "targetVersion",
            ...(rawIntent &&
            typeof rawIntent === "object" &&
            Object.hasOwn(rawIntent, "authorityDirectory")
                ? ["authorityDirectory"]
                : []),
        ]);
        if (
            intent.schemaVersion !== 1 ||
            intent.id !== id ||
            intent.installationId !== `upgrade-${id}` ||
            intent.scope !== scope ||
            intent.expectedPreviousDigest !== expectedPreviousDigest ||
            (intent.authorityDirectory !== undefined &&
                (typeof intent.authorityDirectory !== "string" ||
                    !path.isAbsolute(intent.authorityDirectory))) ||
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
                ...upgradeServiceAuthority(
                    metadata.spec,
                    host,
                    typeof intent.authorityDirectory === "string"
                        ? intent.authorityDirectory
                        : undefined,
                ),
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
            ...(typeof intent.authorityDirectory === "string"
                ? { authorityDirectory: intent.authorityDirectory }
                : {}),
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
