import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { readServiceMetadata } from "./service-metadata.js";
import { inspectServiceMigrationRecovery } from "./service-recovery-inspection.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { installManagerServiceWhileLocked, type ManagerServiceInstallDependencies } from "./manager-service-install.js";
import { ManagerCandidateInstaller, type ManagerCandidateInstallerOptions } from "./manager-runtime/installer.js";
import { GenerationStore } from "./installation/generation-store.js";
import { createGenerationPlan, type GenerationArtifact } from "./installation/generation-plan.js";
import { freezeGenerationArtifacts } from "./installation/generation-artifacts.js";
import { managerCandidateDigest } from "./manager-runtime/identity.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";

export interface ManagerBootstrapRequest {
    id: string;
    service: Omit<ManagerServiceSpec, "binPath" | "workingDirectory">;
}
export interface ManagerBootstrapDependencies extends ManagerServiceInstallDependencies {
    /** 仅可信产品工件配置；不能来自 Web 请求中的 URL 或包名。 */
    artifacts: { host: GenerationArtifact; core: GenerationArtifact };
    download?: ManagerCandidateInstallerOptions["download"];
}
const failure = () => new Error("首次管理服务安装尚未完成，请保留原操作和工件，禁止覆盖或重派系统动作");

/** 候选准备和系统注册共用稳定 ID 与服务锁；不覆盖任何已有服务。 */
export async function bootstrapManagerService(
    request: ManagerBootstrapRequest,
    dependencies: ManagerBootstrapDependencies,
    host: ServiceHost = createDefaultServiceHost(),
) {
    closedServiceObject(request, ["id", "service"]);
    closedServiceObject(request.service, ["schemaVersion", "runtimeKind", "scope", "workspace", "nodePath", "host", "port"]);
    if (typeof request.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(request.id)) throw failure();
    const template = parseManagerServiceSpec({ ...request.service,
        binPath: process.execPath, workingDirectory: path.dirname(process.execPath) });
    if (!["linux", "darwin"].includes(host.platform) || (template.scope === "system" && host.uid !== 0)) throw failure();
    const files = getServiceFiles(template.scope, host);
    const releaseService = acquireServiceMigrationLock(files.stateDir);
    let releaseArtifacts: (() => void) | undefined;
    let installer: ManagerCandidateInstaller | undefined;
    try {
        if (inspectServiceMigrationRecovery(files.stateDir)) throw failure();
        const home = path.join(files.stateDir, "manager-artifacts");
        if (template.workspace === home || template.workspace.startsWith(home + path.sep) ||
            home.startsWith(template.workspace + path.sep)) throw failure();
        if (!fs.existsSync(home)) fs.mkdirSync(home, { mode: 0o700 });
        const stat = fs.lstatSync(home);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
            (process.getuid && stat.uid !== process.getuid()) || fs.realpathSync(home) !== home) throw failure();
        releaseArtifacts = acquireControlWorkspace(home);
        const frozen = await freezeGenerationArtifacts(dependencies.artifacts, path.join(home, "artifacts"));
        const plan = createGenerationPlan({ host: frozen.host, core: frozen.core,
            extensions: [], selection: { adapters: [], protocols: [], applications: [] } });
        const binding = new ServiceOperationStorage(path.join(home, "bootstrap"));
        const intent = { schemaVersion: 1, id: request.id, service: template, planDigest: plan.digest };
        if (binding.has("intent.json")) {
            if (!isDeepStrictEqual(binding.read("intent.json"), intent)) throw failure();
        } else {
            if (readServiceMetadata(files.metadata).kind !== "missing") throw failure();
            binding.write("intent.json", intent, true);
        }
        const journal = new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
        const operations = new ServiceOperationStorage(path.join(files.stateDir, "manager-operations"));
        const existing = operations.has(`${request.id}.json`);
        if (!existing && (journal.health().recoveryRequired || readServiceMetadata(files.metadata).kind !== "missing")) throw failure();
        installer = new ManagerCandidateInstaller({ operationsDirectory: path.join(home, "operations"),
            store: new GenerationStore({ root: path.join(home, "versions"), isActive: () => true }),
            ...(dependencies.download ? { download: dependencies.download } : {}) });
        const boundCandidate = binding.has("candidate.json");
        const installed = existing || boundCandidate
            ? installer.status(request.id)
            : await installer.install(request.id, plan);
        if (installed.phase !== "verified" || installed.planDigest !== plan.digest || !installed.candidateId) throw failure();
        const candidate = installer.readCandidate(installed.candidateId);
        const digest = managerCandidateDigest(candidate);
        const spec = parseManagerServiceSpec({ ...template, workingDirectory: candidate.directory,
            binPath: path.join(candidate.directory, "node_modules/onebots/lib/bin.js") });
        verifyManagerServiceCandidate(spec, digest);
        const receipt = { schemaVersion: 1, id: request.id, planDigest: plan.digest,
            candidateId: candidate.id, candidateDigest: digest, spec };
        if (binding.has("candidate.json")) {
            if (!isDeepStrictEqual(binding.read("candidate.json"), receipt)) throw failure();
        } else {
            if (existing) throw failure();
            binding.write("candidate.json", receipt, true);
        }
        if (existing) {
            const record = journal.recoverable(request.id);
            if (record.action !== "install" || !isDeepStrictEqual(record.managerSpec, spec)) throw failure();
            return record; // 返回原操作事实，不重新写定义、reload 或释放维护门禁。
        }
        return await installManagerServiceWhileLocked(spec, request.id, host, dependencies);
    } finally {
        try { await installer?.close(); }
        finally {
            try { releaseArtifacts?.(); }
            finally { releaseService(); }
        }
    }
}
