import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import type { ServiceScope } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import { readServiceMetadata } from "./service-metadata.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { inspectServiceMigrationRecovery } from "./service-recovery-inspection.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { readRunningManagerCandidate, managerCandidateDigest } from "./manager-runtime/identity.js";
import { readVerifiedManagerCandidate } from "./manager-runtime/reader.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { assertNoPendingManagerUpgrade } from "./service-upgrade-workspace.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { verifyServiceMigrationProcesses } from "./service-migration-processes.js";
import { closedServiceObject } from "./service-operation-storage.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { createManagerServiceUpgradeNativePort, type ManagerUpgradeNativeDependencies } from "./manager-service-upgrade-native-port.js";
import { runManagerServiceUpgrade } from "./manager-service-upgrade-transaction.js";

export interface ManagerServiceUpgradeRequest {
    id: string;
    scope: ServiceScope;
    candidateDirectory: string;
    candidateDigest: string;
}
const failure = () => new Error("管理服务升级准备失败，未派发系统动作；请核对已纳管候选及待恢复操作");

/**
 * 本机外部协调入口；不能在待停止的 manager 自身执行。
 * 只接受已验证的独立管理工件，下载和旧安装纳管不在此处隐式执行。
 * 锁顺序固定为服务锁、按路径排序的管理工件工作区锁；整个事务结束才释放。
 */
export async function upgradeManagerService(
    input: ManagerServiceUpgradeRequest,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerUpgradeNativeDependencies = {},
) {
    const value = closedServiceObject(input, ["id", "scope", "candidateDirectory", "candidateDigest"]);
    if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
        (value.scope !== "user" && value.scope !== "system") ||
        typeof value.candidateDirectory !== "string" || !path.isAbsolute(value.candidateDirectory) ||
        typeof value.candidateDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.candidateDigest) ||
        (host.platform !== "linux" && host.platform !== "darwin") || (value.scope === "system" && host.uid !== 0)) throw failure();
    const scope = value.scope;
    const files = getServiceFiles(scope, host);
    const releaseService = acquireServiceMigrationLock(files.stateDir);
    const releases: (() => void)[] = [];
    let operationFailed = false;
    try {
        if (inspectServiceMigrationRecovery(files.stateDir)) throw failure();
        const journal = new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
        if (journal.health().recoveryRequired) throw failure();
        const metadata = readServiceMetadata(files.metadata);
        if (metadata.kind !== "control" || metadata.spec.scope !== scope) throw failure();
        const previousSpec = metadata.spec;
        assertNoPendingManagerUpgrade(previousSpec.workspace);
        if (readServiceMigrationPending(previousSpec.workspace)) throw failure();
        const previous = readRunningManagerCandidate(pathToFileURL(
            path.join(path.dirname(previousSpec.binPath), "control/host.js"),
        ).href);
        const directory = value.candidateDirectory;
        if (fs.realpathSync(directory) !== directory) throw failure();
        const target = readVerifiedManagerCandidate(path.dirname(directory), path.basename(directory));
        // 安装器以工件工作区持锁，其下 versions 存放不可变候选。
        const homes = [...new Set([previous.directory, target.directory].map(candidate =>
            path.dirname(path.dirname(candidate))))].sort();
        for (const home of homes) {
            if (home === previousSpec.workspace || fs.realpathSync(home) !== home) throw failure();
            for (const item of [home, path.join(home, ".control")]) {
                const stat = fs.lstatSync(item);
                if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
                    (process.getuid && stat.uid !== process.getuid())) throw failure();
            }
            releases.push(acquireControlWorkspace(home));
        }
        const previousDigest = managerCandidateDigest(previous);
        const spec = { ...previousSpec, workingDirectory: target.directory,
            binPath: path.join(target.directory, "node_modules/onebots/lib/bin.js") };
        verifyManagerServiceCandidate(previousSpec, previousDigest);
        verifyManagerServiceCandidate(spec, value.candidateDigest);
        if (previousDigest === value.candidateDigest) throw failure();
        const confirm = dependencies.confirmStopped ?? verifyServiceMigrationProcesses;
        const platform = dependencies.platform ?? (host.platform === "linux"
            ? new SystemdServicePlatform(host, scope, files.definition)
            : new LaunchdServicePlatform(host, scope, files.definition, {
                confirmUnloadedProcesses: () => confirm(spec.workspace),
            }));
        const captured = captureManagerServiceRemoval(previousSpec, host);
        try {
            const initial = await platform.inspect();
            if (initial.definitionPath !== files.definition ||
                (initial.state === "running" ? !initial.running || !initial.identity || initial.processId === null
                    : initial.state !== "stopped" || initial.running || initial.processId !== null || !initial.quiescent) ||
                !isDeepStrictEqual(initial, await platform.inspect()) || !captured.verifyRemaining()) throw failure();
            return await runManagerServiceUpgrade({
                id: value.id, action: "upgrade", desiredEnabled: initial.enabled, spec,
                upgrade: { previousSpec, previousCandidateDigest: previousDigest,
                    candidateDigest: value.candidateDigest, snapshot: { platform: host.platform,
                        files: captured.snapshot, initial: { enabled: initial.enabled,
                            processId: initial.processId, identity: initial.identity } } },
            }, journal, createManagerServiceUpgradeNativePort(host, { ...dependencies, platform }));
        } finally { captured.dispose(); }
    } catch (error) {
        operationFailed = true;
        throw error;
    } finally {
        let releaseFailed = false;
        // 单个释放失败不能跳过其余锁，也不能覆盖原事务的中断语义。
        for (const release of [...releases.reverse(), releaseService]) {
            try { release(); }
            catch { releaseFailed = true; /* 统一报告，避免暴露锁数据库路径和底层错误。 */ }
        }
        if (releaseFailed && !operationFailed)
            throw new Error("管理服务升级已完成，但锁释放未确认；请核对原操作结果，禁止重复升级");
    }
}
