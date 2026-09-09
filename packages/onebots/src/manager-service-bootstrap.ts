import { selectManagerBootstrapCycle } from "./manager-bootstrap-cycle.js";
import { managerBootstrapBindingDirectory } from "./manager-bootstrap-binding.js";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { readServiceMetadata } from "./service-metadata.js";
import { inspectServiceMigrationRecovery } from "./service-recovery-inspection.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import {
    installManagerServiceWhileLocked,
    type ManagerServiceInstallDependencies,
} from "./manager-service-install.js";
import {
    ManagerCandidateInstaller,
    type ManagerCandidateInstallerOptions,
} from "./manager-runtime/installer.js";
import { GenerationStore } from "./installation/generation-store.js";
import { createGenerationPlan, type GenerationArtifact } from "./installation/generation-plan.js";
import { bundledPnpmExecutor } from "./installation/bundled-runtime-artifacts.js";
import { freezeGenerationArtifacts } from "./installation/generation-artifacts.js";
import { managerCandidateDigest } from "./manager-runtime/identity.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { assertManagerServiceTransactionsSupported } from "./windows-manager-support.js";
import {
    inspectWindowsServiceDirectorySecurity,
    secureWindowsServiceDirectory,
    secureWindowsServiceFile,
} from "./windows-service-security.js";
import { createControlOperationObserver } from "./control/gateway-log.js";
import {
    deriveManagerBootstrapStageError,
    ManagerBootstrapCandidateError,
    type ManagerBootstrapPhase,
} from "./manager-bootstrap-error.js";

export interface ManagerBootstrapRequest {
    id?: string;
    service: Omit<ManagerServiceSpec, "binPath" | "workingDirectory">;
}
export interface ManagerBootstrapDependencies extends ManagerServiceInstallDependencies {
    /** 仅可信产品工件配置；不能来自 Web 请求中的 URL 或包名。 */
    artifacts: { host: GenerationArtifact; core: GenerationArtifact };
    download?: ManagerCandidateInstallerOptions["download"];
}
const failure = () =>
    new Error("首次管理服务安装尚未完成，请保留原操作和工件，禁止覆盖或重派系统动作");

/** 候选准备和系统注册共用稳定 ID 与服务锁；不覆盖任何已有服务。 */
export async function bootstrapManagerService(
    request: ManagerBootstrapRequest,
    dependencies: ManagerBootstrapDependencies,
    host: ServiceHost = createDefaultServiceHost(),
) {
    assertManagerServiceTransactionsSupported(host);
    closedServiceObject(request, ["service", ...(Object.hasOwn(request, "id") ? ["id"] : [])]);
    closedServiceObject(request.service, [
        "schemaVersion",
        "runtimeKind",
        "scope",
        "workspace",
        "nodePath",
        "host",
        "port",
    ]);
    if (
        Object.hasOwn(request, "id") &&
        (typeof request.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(request.id))
    )
        throw failure();
    const template = parseManagerServiceSpec({
        ...request.service,
        binPath: process.execPath,
        workingDirectory: path.dirname(process.execPath),
    });
    if (
        !["linux", "darwin", "win32"].includes(host.platform) ||
        (host.platform === "win32"
            ? template.scope !== "system"
            : template.scope === "system" && host.uid !== 0)
    )
        throw failure();
    const files = getServiceFiles(template.scope, host);
    if (host.platform === "win32") {
        secureWindowsServiceDirectory(host, files.stateDir);
        // Windows 空白工作区与服务状态使用同一最小 ACL；已存在但边界不同的目录拒绝接管。
        secureWindowsServiceDirectory(host, template.workspace);
    }
    const releaseService = acquireServiceMigrationLock(files.stateDir);
    let releaseArtifacts: (() => void) | undefined;
    let installer: ManagerCandidateInstaller | undefined;
    let operationId: string | undefined;
    let bootstrapPhase: ManagerBootstrapPhase = "candidate-preparation";
    try {
        if (inspectServiceMigrationRecovery(files.stateDir)) throw failure();
        const id = request.id ?? selectManagerBootstrapCycle(template.scope, host);
        operationId = id;
        const home = path.join(files.stateDir, "manager-artifacts");
        if (
            template.workspace === home ||
            template.workspace.startsWith(home + path.sep) ||
            home.startsWith(template.workspace + path.sep)
        )
            throw failure();
        if (host.platform === "win32") secureWindowsServiceDirectory(host, home);
        else if (!fs.existsSync(home)) fs.mkdirSync(home, { mode: 0o700 });
        const stat = fs.lstatSync(home);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (process.platform !== "win32" && (stat.mode & 0o077) !== 0) ||
            (process.platform !== "win32" && process.getuid && stat.uid !== process.getuid()) ||
            fs.realpathSync(home) !== home
        )
            throw failure();
        if (host.platform === "win32")
            secureWindowsServiceDirectory(host, path.join(home, ".control"));
        releaseArtifacts = acquireControlWorkspace(home);
        const frozen = await freezeGenerationArtifacts(
            dependencies.artifacts,
            path.join(home, "artifacts"),
        );
        const plan = createGenerationPlan({
            host: frozen.host,
            core: frozen.core,
            extensions: [],
            selection: { adapters: [], protocols: [], applications: [] },
        });
        const bindingDirectory = managerBootstrapBindingDirectory(home, id);
        if (host.platform === "win32") {
            secureWindowsServiceDirectory(host, path.dirname(bindingDirectory));
            secureWindowsServiceDirectory(host, bindingDirectory);
        }
        const binding = new ServiceOperationStorage(bindingDirectory);
        const intent = { schemaVersion: 1, id: id, service: template, planDigest: plan.digest };
        if (binding.has("intent.json")) {
            if (!isDeepStrictEqual(binding.read("intent.json"), intent)) throw failure();
        } else {
            if (readServiceMetadata(files.metadata).kind !== "missing") throw failure();
            binding.write("intent.json", intent, true);
            if (host.platform === "win32")
                secureWindowsServiceFile(host, path.join(bindingDirectory, "intent.json"));
        }
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
            dependencies.onOperation ?? createControlOperationObserver(template.workspace),
        );
        const operations = new ServiceOperationStorage(
            path.join(files.stateDir, "manager-operations"),
        );
        const existing = operations.has(`${id}.json`);
        if (
            !existing &&
            (journal.health().recoveryRequired ||
                readServiceMetadata(files.metadata).kind !== "missing")
        )
            throw failure();
        if (host.platform === "win32")
            secureWindowsServiceDirectory(host, path.join(home, "versions"));
        installer = new ManagerCandidateInstaller({
            operationsDirectory: path.join(home, "operations"),
            store: new GenerationStore({
                root: path.join(home, "versions"),
                isActive: id => {
                    // 新候选必须允许提交收据；只有持久绑定的候选受活动版本保护。
                    // 已验证版本另由 GenerationStore.discard 的收据门禁保护，不在此回收。
                    if (!binding.has("candidate.json")) return false;
                    const bound = closedServiceObject(binding.read("candidate.json"), [
                        "schemaVersion",
                        "id",
                        "planDigest",
                        "candidateId",
                        "candidateDigest",
                        "spec",
                    ]);
                    if (typeof bound.candidateId !== "string") throw failure();
                    return bound.candidateId === id;
                },
            }),
            ...bundledPnpmExecutor(),
            ...(dependencies.download ? { download: dependencies.download } : {}),
        });
        const boundCandidate = binding.has("candidate.json");
        let installed;
        bootstrapPhase = "candidate-queued";
        try {
            installed =
                existing || boundCandidate
                    ? installer.status(id)
                    : await installer.install(id, plan);
        } catch (error) {
            if (host.platform !== "win32" || typeof installer.installationStatus !== "function")
                throw error;
            let evidence;
            try {
                evidence = installer.installationStatus(id);
            } catch {
                throw error;
            }
            if (evidence.error)
                throw new ManagerBootstrapCandidateError(id, evidence.phase, evidence.error);
            if (evidence.phase === "verified")
                throw new ManagerBootstrapCandidateError(
                    id,
                    evidence.phase,
                    "CANDIDATE_READ_FAILED",
                );
            throw failure();
        }
        if (
            installed.phase !== "verified" ||
            installed.planDigest !== plan.digest ||
            !installed.candidateId
        ) {
            if (installed.error)
                throw new ManagerBootstrapCandidateError(id, installed.phase, installed.error);
            throw failure();
        }
        bootstrapPhase = "candidate-verified";
        let candidate;
        bootstrapPhase = "candidate-read";
        try {
            candidate = installer.readCandidate(installed.candidateId);
        } catch (error) {
            if (host.platform !== "win32") throw error;
            throw new ManagerBootstrapCandidateError(id, "verified", "CANDIDATE_READ_FAILED");
        }
        if (host.platform === "win32") {
            bootstrapPhase = "candidate-security";
            try {
                inspectWindowsServiceDirectorySecurity(host, candidate.directory);
            } catch (error) {
                if (host.platform !== "win32") throw error;
                throw new ManagerBootstrapCandidateError(
                    id,
                    "verified",
                    "CANDIDATE_SECURITY_FAILED",
                );
            }
        }
        let digest;
        let spec;
        bootstrapPhase = "candidate-identity";
        try {
            digest = managerCandidateDigest(candidate);
            spec = parseManagerServiceSpec({
                ...template,
                workingDirectory: candidate.directory,
                binPath: path.join(candidate.directory, "node_modules/onebots/lib/bin.js"),
            });
            verifyManagerServiceCandidate(spec, digest);
        } catch (error) {
            if (host.platform !== "win32") throw error;
            throw new ManagerBootstrapCandidateError(id, "verified", "CANDIDATE_IDENTITY_FAILED");
        }
        const receipt = {
            schemaVersion: 1,
            id: id,
            planDigest: plan.digest,
            candidateId: candidate.id,
            candidateDigest: digest,
            spec,
        };
        bootstrapPhase = "candidate-binding";
        try {
            if (binding.has("candidate.json")) {
                if (!isDeepStrictEqual(binding.read("candidate.json"), receipt)) throw failure();
            } else {
                if (existing) throw failure();
                binding.write("candidate.json", receipt, true);
                if (host.platform === "win32")
                    secureWindowsServiceFile(host, path.join(bindingDirectory, "candidate.json"));
            }
        } catch (error) {
            if (host.platform !== "win32") throw error;
            throw new ManagerBootstrapCandidateError(id, "verified", "CANDIDATE_BINDING_FAILED");
        }
        bootstrapPhase = "manager-preflight";
        if (existing) {
            const record = journal.recoverable(id);
            if (record.action !== "install" || !isDeepStrictEqual(record.managerSpec, spec))
                throw failure();
            if (record.status === "succeeded" && !record.recoveryRequired) {
                const current = readServiceMetadata(files.metadata);
                if (current.kind !== "control" || !isDeepStrictEqual(current.spec, spec))
                    throw failure();
                const captured = captureManagerServiceRemoval(spec, host);
                try {
                    if (!captured.verifyRemaining()) throw failure();
                } finally {
                    captured.dispose();
                }
            }
            return record; // 返回原操作事实，不重新写定义、reload 或释放维护门禁。
        }
        return await installManagerServiceWhileLocked(spec, id, host, dependencies);
    } catch (error) {
        if (
            host.platform === "win32" &&
            operationId &&
            !(error instanceof ManagerBootstrapCandidateError)
        )
            throw deriveManagerBootstrapStageError(files.stateDir, operationId, bootstrapPhase);
        throw error;
    } finally {
        try {
            await installer?.close();
        } finally {
            try {
                releaseArtifacts?.();
            } finally {
                releaseService();
            }
        }
    }
}
