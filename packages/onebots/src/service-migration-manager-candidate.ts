import fs from "node:fs";
import path from "node:path";
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
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";

export interface ServiceMigrationManagerCandidateDependencies {
    /** 仅来自可信产品配置，不能接受管理请求传入任意包地址。 */
    artifacts: { host: GenerationArtifact; core: GenerationArtifact };
    download?: ManagerCandidateInstallerOptions["download"];
}
const failure = () => new Error("迁移管理候选尚未验证，请保留原操作和工件，禁止重新安装或覆盖");

/** 调用方持有服务锁并已持久化 preparing-manager 意图；这里只准备工件，不注册系统服务。 */
export async function prepareServiceMigrationManagerCandidate(
    backup: ServiceMigrationBackup,
    stateDirectory: string,
    id: string,
    dependencies: ServiceMigrationManagerCandidateDependencies,
): Promise<{ spec: ManagerServiceSpec; digest: string }> {
    if (
        typeof id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
        !path.isAbsolute(stateDirectory) ||
        path.normalize(stateDirectory) !== stateDirectory
    )
        throw failure();
    const target = parseManagerServiceSpec(backup.target);
    const home = path.join(stateDirectory, "manager-artifacts");
    if (
        target.workspace === home ||
        target.workspace.startsWith(home + path.sep) ||
        home.startsWith(target.workspace + path.sep)
    )
        throw failure();
    privateDirectory(stateDirectory, false);
    privateDirectory(home);
    const release = acquireControlWorkspace(home);
    let installer: ManagerCandidateInstaller | undefined;
    try {
        const migrations = path.join(home, "migrations");
        privateDirectory(migrations);
        const directory = path.join(migrations, id);
        privateDirectory(directory);
        const binding = new ServiceOperationStorage(directory);
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
        const operationId = `migration-${id}`;
        const intent = { schemaVersion: 1, id, operationId, target, planDigest: plan.digest };
        const existing = binding.has("intent.json");
        if (existing) {
            if (!isDeepStrictEqual(binding.read("intent.json"), intent)) throw failure();
        } else {
            // 缺失绑定但已有结果属于未知历史，不能补写意图并重新派发。
            if (
                binding.has("candidate.json") ||
                fs.existsSync(path.join(home, "operations", `${operationId}.json`))
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
                        "digest",
                        "spec",
                    ]);
                    if (typeof receipt.candidateId !== "string") throw failure();
                    return receipt.candidateId === candidateId;
                },
            }),
            ...bundledPnpmExecutor(),
            ...(dependencies.download ? { download: dependencies.download } : {}),
        });
        // 即使第一次调用在安装日志落盘前崩溃，也只查询历史，不自动重派。
        const installed = existing
            ? installer.status(operationId)
            : await installer.install(operationId, plan);
        if (
            installed.phase !== "verified" ||
            installed.planDigest !== plan.digest ||
            !installed.candidateId
        )
            throw failure();
        const candidate = installer.readCandidate(installed.candidateId);
        if (candidate.operationId !== operationId || candidate.planDigest !== plan.digest)
            throw failure();
        const digest = managerCandidateDigest(candidate);
        const spec = parseManagerServiceSpec({
            ...target,
            workingDirectory: candidate.directory,
            binPath: path.join(candidate.directory, "node_modules/onebots/lib/bin.js"),
        });
        verifyManagerServiceCandidate(spec, digest);
        const receipt = {
            schemaVersion: 1,
            id,
            planDigest: plan.digest,
            candidateId: candidate.id,
            digest,
            spec,
        };
        if (!isDeepStrictEqual(binding.read("intent.json"), intent)) throw failure();
        if (binding.has("candidate.json")) {
            if (!isDeepStrictEqual(binding.read("candidate.json"), receipt)) throw failure();
        } else binding.write("candidate.json", receipt, true);
        return { spec, digest };
    } finally {
        try {
            await installer?.close();
        } finally {
            release();
        }
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
