import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import semver from "semver";
import type { TuiPrompt } from "../tui/prompt.js";
import {
    resolveLocalRelease,
    resolveRelease,
    type ResolvedRelease,
} from "../installation/release-resolver.js";
import {
    managerCandidateDigest,
    readRunningManagerCandidate,
} from "../manager-runtime/identity.js";
import {
    prepareManagerUpgradeCandidate,
    resumeManagerUpgradeCandidate,
    ManagerUpgradeCandidateRejectedError,
    type PreparedManagerUpgradeCandidate,
} from "../manager-service-upgrade-preparation.js";
import {
    upgradeManagerService,
    ManagerServiceUpgradeRejectedError,
} from "../manager-service-upgrade.js";
import type { ServiceScope } from "../service-definition.js";
import { getServiceFiles } from "../service-files.js";
import { createDefaultServiceHost, type ServiceHost } from "../service-host.js";
import { readServiceMetadata } from "../service-metadata.js";

export interface ManagerProgramUpdateOptions {
    check: boolean;
    yes: boolean;
    system: boolean;
    version?: string;
    operationId?: string;
    artifacts?: string;
}

interface InstalledManager {
    version: string;
    digest: string;
}

export interface ManagerProgramUpdateDependencies {
    host?: ServiceHost;
    resolve?(version?: string): Promise<ResolvedRelease>;
    inspect?(scope: ServiceScope, host: ServiceHost): InstalledManager;
    prepare?(
        input: Parameters<typeof prepareManagerUpgradeCandidate>[0],
        host: ServiceHost,
    ): Promise<PreparedManagerUpgradeCandidate>;
    resume?(
        id: string,
        scope: ServiceScope,
        expectedPreviousDigest: string,
        host: ServiceHost,
        expectedVersion?: string,
    ): Promise<PreparedManagerUpgradeCandidate>;
    upgrade?(
        input: Parameters<typeof upgradeManagerService>[0],
        host: ServiceHost,
    ): Promise<unknown>;
    operationExists?(id: string, scope: ServiceScope, host: ServiceHost): boolean;
    randomId?(): string;
    prompt?: TuiPrompt;
    interactive: boolean;
    output(value: string): void;
}

export async function runManagerProgramUpdate(
    options: ManagerProgramUpdateOptions,
    dependencies: ManagerProgramUpdateDependencies,
): Promise<number> {
    const host = dependencies.host ?? createDefaultServiceHost();
    const scope: ServiceScope = options.system ? "system" : "user";
    if (host.platform !== "linux" && host.platform !== "darwin")
        throw new Error("管理程序原生升级仅支持 Linux 和 macOS；Windows 未执行任何安装或服务动作");
    if (scope === "system" && host.uid !== 0)
        throw new Error("系统级管理程序升级需要 root；未下载候选或修改系统服务");
    if (
        options.operationId &&
        (dependencies.operationExists ?? operationExists)(options.operationId, scope, host)
    ) {
        dependencies.output(
            `操作 ${options.operationId} 已进入系统服务事务；请执行 onebots recover --operation ${options.operationId}${options.system ? " --system" : ""} 对账，不会重放系统动作。`,
        );
        return 1;
    }
    const current = (dependencies.inspect ?? inspectInstalledManager)(scope, host);
    if (options.operationId) {
        const id = options.operationId;
        dependencies.output(
            `正在离线核对管理程序升级操作 ${id}；验证原候选后继续同一服务切换，不访问发布源或重新安装。`,
        );
        try {
            const candidate = await (dependencies.resume ?? resumeManagerUpgradeCandidate)(
                id,
                scope,
                current.digest,
                host,
                options.version,
            );
            dependencies.output(
                JSON.stringify({
                    scope: "manager",
                    serviceScope: scope,
                    state: "resuming",
                    currentVersion: current.version,
                    targetVersion: candidate.targetVersion,
                    archiveSha256: candidate.archiveSha256,
                    coreArchiveSha256: candidate.coreArchiveSha256,
                }),
            );
            await (dependencies.upgrade ?? upgradeManagerService)(
                {
                    id,
                    scope,
                    candidateDirectory: candidate.candidateDirectory,
                    candidateDigest: candidate.candidateDigest,
                    expectedPreviousDigest: current.digest,
                },
                host,
            );
            dependencies.output(
                `操作 ${id}：管理程序已切换到 ${candidate.targetVersion}；候选证明摘要 ${candidate.candidateDigest}。`,
            );
            return 0;
        } catch (error) {
            throw managerUpdateFailure(error, id, options.system, options.version);
        }
    }
    const release = await (
        dependencies.resolve ??
        (options.artifacts
            ? version => resolveLocalRelease(options.artifacts!, version)
            : resolveRelease)
    )(options.version);
    if (
        !release.archives ||
        release.archives.host.sha256 !== release.archiveSha256 ||
        !Buffer.isBuffer(release.archives.host.bytes) ||
        !Buffer.isBuffer(release.archives.core.bytes) ||
        !/^[a-f0-9]{64}$/.test(release.archives.core.sha256)
    )
        throw new Error("目标管理程序缺少已验证的宿主或 core 归档，未准备候选");
    const comparison = semver.compare(release.host.version, current.version);
    const state =
        comparison === 0
            ? "current"
            : comparison > 0
              ? "updates_available"
              : options.version
                ? "target_selected"
                : "ahead";
    const summary = {
        scope: "manager" as const,
        serviceScope: scope,
        state,
        currentVersion: current.version,
        targetVersion: release.host.version,
        archiveSha256: release.archiveSha256,
        coreArchiveSha256: release.archives.core.sha256,
    };
    if (options.check) {
        dependencies.output(JSON.stringify(summary));
        return state === "updates_available" || state === "target_selected" ? 2 : 0;
    }
    if (state === "current" || state === "ahead") {
        dependencies.output(JSON.stringify(summary));
        return 0;
    }
    if (!options.operationId && !dependencies.interactive && !options.yes)
        throw new Error("非交互管理程序升级必须传入 --yes，确认已核对版本摘要；未下载候选");
    if (!options.operationId && dependencies.interactive && !options.yes) {
        if (!dependencies.prompt) throw new Error("交互管理程序升级需要终端确认；未下载候选");
        const answer = await dependencies.prompt.ask({
            title: "确认升级常驻管理程序？",
            detail: `范围：${scope}\n当前版本：${current.version}\n目标版本：${release.host.version}${state === "target_selected" ? "（显式选择较低版本）" : ""}\n宿主归档 SHA-256：${release.archiveSha256}\ncore 归档 SHA-256：${release.archives.core.sha256}\n将准备独立不可变候选，验证后切换系统服务。`,
            choices: [
                { value: "yes", label: "确认升级" },
                { value: "no", label: "取消" },
            ],
        });
        if (!answer.includes("yes")) {
            dependencies.output("已取消管理程序升级；未下载候选或修改系统服务。");
            return 0;
        }
    }
    const id = options.operationId ?? (dependencies.randomId ?? randomUUID)();
    dependencies.output(
        `管理程序升级操作 ID：${id}\n${JSON.stringify(summary)}\n结果未知时保留此 ID，禁止重新发起另一升级。`,
    );
    try {
        const candidate = await (dependencies.prepare ?? prepareManagerUpgradeCandidate)(
            {
                id,
                scope,
                expectedPreviousDigest: current.digest,
                archiveSha256: release.archiveSha256,
                artifacts: { host: release.host, core: release.core },
                archives: release.archives,
            },
            host,
        );
        await (dependencies.upgrade ?? upgradeManagerService)(
            {
                id,
                scope,
                candidateDirectory: candidate.candidateDirectory,
                candidateDigest: candidate.candidateDigest,
                expectedPreviousDigest: current.digest,
            },
            host,
        );
        dependencies.output(
            `操作 ${id}：管理程序已切换到 ${candidate.targetVersion}；候选证明摘要 ${candidate.candidateDigest}。`,
        );
        return 0;
    } catch (error) {
        throw managerUpdateFailure(error, id, options.system, release.host.version);
    }
}

function managerUpdateFailure(
    error: unknown,
    id: string,
    system: boolean,
    expectedVersion?: string,
): Error {
    if (
        error instanceof ManagerUpgradeCandidateRejectedError ||
        error instanceof ManagerServiceUpgradeRejectedError
    )
        return new Error(
            `操作 ${id} 在系统效果派发前被明确拒绝。可修复原因后查询原操作，或创建新的升级操作。`,
        );
    return new Error(
        `操作 ${id} 的结果尚未确认。候选阶段仅可用 update --manager --operation ${id}${expectedVersion ? ` --version ${expectedVersion}` : ""}${system ? " --system" : ""} 离线核对候选，验证后继续同一服务切换；若已进入系统服务事务，请用 recover --operation ${id}${system ? " --system" : ""} 对账。禁止重新安装或重派系统动作。`,
    );
}

function inspectInstalledManager(scope: ServiceScope, host: ServiceHost): InstalledManager {
    const metadata = readServiceMetadata(getServiceFiles(scope, host).metadata);
    if (metadata.kind !== "control" || metadata.spec.scope !== scope)
        throw new Error("未找到可验证的常驻管理服务；请先执行 install 或 migrate");
    const candidate = readRunningManagerCandidate(
        pathToFileURL(path.join(path.dirname(metadata.spec.binPath), "control/host.js")).href,
    );
    return { version: candidate.receipt.hostVersion, digest: managerCandidateDigest(candidate) };
}

function operationExists(id: string, scope: ServiceScope, host: ServiceHost): boolean {
    try {
        const file = path.join(
            getServiceFiles(scope, host).stateDir,
            "manager-operations",
            `${id}.json`,
        );
        const stat = fs.lstatSync(file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            (stat.mode & 0o077) !== 0 ||
            (process.getuid && stat.uid !== process.getuid())
        )
            throw new Error();
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw new Error("无法确认原管理升级操作；未重派任何动作");
    }
}
