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
import { WindowsServicePlatform } from "./service-platform-windows.js";
import {
    createManagerServiceUpgradeNativePort,
    type ManagerUpgradeNativeDependencies,
} from "./manager-service-upgrade-native-port.js";
import { runManagerServiceUpgrade } from "./manager-service-upgrade-transaction.js";
import { createControlOperationObserver } from "./control/gateway-log.js";
import { inspectWindowsServiceDirectorySecurity } from "./windows-service-security.js";

export interface ManagerServiceUpgradeRequest {
    id: string;
    scope: ServiceScope;
    candidateDirectory: string;
    candidateDigest: string;
    /** CLI 准备候选前读取的活动管理版本；存在时在服务锁内做 CAS。 */
    expectedPreviousDigest?: string;
}
export type ManagerServiceUpgradeRejectionCode =
    | "INVALID_REQUEST"
    | "SERVICE_BUSY"
    | "SERVICE_METADATA_INVALID"
    | "CANDIDATE_INVALID"
    | "SERVICE_STATE_CHANGED"
    | "SERVICE_FILES_INVALID"
    | "PLATFORM_INITIAL_INVALID"
    | "PLATFORM_UNSTABLE"
    | "SERVICE_FILES_CHANGED"
    | "PREFLIGHT_FAILED";
const rejectionCodes = new Set<ManagerServiceUpgradeRejectionCode>([
    "INVALID_REQUEST",
    "SERVICE_BUSY",
    "SERVICE_METADATA_INVALID",
    "CANDIDATE_INVALID",
    "SERVICE_STATE_CHANGED",
    "SERVICE_FILES_INVALID",
    "PLATFORM_INITIAL_INVALID",
    "PLATFORM_UNSTABLE",
    "SERVICE_FILES_CHANGED",
    "PREFLIGHT_FAILED",
]);
export class ManagerServiceUpgradeRejectedError extends Error {
    readonly code: ManagerServiceUpgradeRejectionCode;
    constructor(code: unknown = "PREFLIGHT_FAILED") {
        super("管理服务升级准备失败，未派发系统动作；请核对已纳管候选及待恢复操作");
        this.code = rejectionCodes.has(code as ManagerServiceUpgradeRejectionCode)
            ? (code as ManagerServiceUpgradeRejectionCode)
            : "PREFLIGHT_FAILED";
    }
}
const failure = (code: ManagerServiceUpgradeRejectionCode = "PREFLIGHT_FAILED") =>
    new ManagerServiceUpgradeRejectedError(code);

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
    const value = closedServiceObject(input, [
        "id",
        "scope",
        "candidateDirectory",
        "candidateDigest",
        ...(Object.hasOwn(input, "expectedPreviousDigest") ? ["expectedPreviousDigest"] : []),
    ]);
    if (
        typeof value.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
        (value.scope !== "user" && value.scope !== "system") ||
        typeof value.candidateDirectory !== "string" ||
        !path.isAbsolute(value.candidateDirectory) ||
        typeof value.candidateDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.candidateDigest) ||
        (value.expectedPreviousDigest !== undefined &&
            (typeof value.expectedPreviousDigest !== "string" ||
                !/^[a-f0-9]{64}$/.test(value.expectedPreviousDigest))) ||
        (host.platform !== "linux" && host.platform !== "darwin" && host.platform !== "win32") ||
        (host.platform === "win32"
            ? value.scope !== "system" || host.isElevated !== true
            : value.scope === "system" && host.uid !== 0)
    )
        throw failure("INVALID_REQUEST");
    const scope = value.scope;
    const files = getServiceFiles(scope, host);
    let releaseService: () => void;
    try {
        releaseService = acquireServiceMigrationLock(files.stateDir, host);
    } catch {
        throw failure("SERVICE_BUSY");
    }
    const releases: (() => void)[] = [];
    let operationFailed = false;
    let transactionEntered = false;
    try {
        if (inspectServiceMigrationRecovery(files.stateDir)) throw failure("SERVICE_BUSY");
        const metadata = readServiceMetadata(files.metadata);
        if (metadata.kind !== "control" || metadata.spec.scope !== scope)
            throw failure("SERVICE_METADATA_INVALID");
        const previousSpec = metadata.spec;
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
            dependencies.onOperation ?? createControlOperationObserver(previousSpec.workspace),
        );
        if (journal.health().recoveryRequired) throw failure("SERVICE_BUSY");
        try {
            assertNoPendingManagerUpgrade(previousSpec.workspace);
        } catch {
            throw failure("SERVICE_BUSY");
        }
        if (readServiceMigrationPending(previousSpec.workspace)) throw failure("SERVICE_BUSY");
        const previous = readRunningManagerCandidate(
            pathToFileURL(path.join(path.dirname(previousSpec.binPath), "control/host.js")).href,
        );
        const directory = value.candidateDirectory;
        if (fs.realpathSync(directory) !== directory) throw failure("CANDIDATE_INVALID");
        const target = readVerifiedManagerCandidate(
            path.dirname(directory),
            path.basename(directory),
        );
        // 安装器以工件工作区持锁，其下 versions 存放不可变候选。
        const homes = [
            ...new Set(
                [previous.directory, target.directory].map(candidate =>
                    path.dirname(path.dirname(candidate)),
                ),
            ),
        ].sort();
        for (const home of homes) {
            if (home === previousSpec.workspace || fs.realpathSync(home) !== home)
                throw failure("CANDIDATE_INVALID");
            for (const item of [home, path.join(home, ".control")]) {
                const stat = fs.lstatSync(item);
                if (
                    !stat.isDirectory() ||
                    stat.isSymbolicLink() ||
                    (host.platform !== "win32" && (stat.mode & 0o077) !== 0) ||
                    (host.platform !== "win32" && process.getuid && stat.uid !== process.getuid())
                )
                    throw failure("CANDIDATE_INVALID");
                if (host.platform === "win32") inspectWindowsServiceDirectorySecurity(host, item);
            }
            releases.push(acquireControlWorkspace(home, host));
        }
        const previousDigest = managerCandidateDigest(previous);
        if (
            value.expectedPreviousDigest !== undefined &&
            previousDigest !== value.expectedPreviousDigest
        )
            throw failure("SERVICE_STATE_CHANGED");
        const spec = {
            ...previousSpec,
            workingDirectory: target.directory,
            binPath: path.join(target.directory, "node_modules/onebots/lib/bin.js"),
        };
        verifyManagerServiceCandidate(previousSpec, previousDigest);
        verifyManagerServiceCandidate(spec, value.candidateDigest);
        if (previousDigest === value.candidateDigest) throw failure("CANDIDATE_INVALID");
        const confirm = dependencies.confirmStopped ?? verifyServiceMigrationProcesses;
        const platform =
            dependencies.platform ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, scope, files.definition)
                : host.platform === "darwin"
                  ? new LaunchdServicePlatform(host, scope, files.definition, {
                        confirmUnloadedProcesses: () => confirm(spec.workspace),
                    })
                  : new WindowsServicePlatform(host, scope, files.definition));
        let captured: ReturnType<typeof captureManagerServiceRemoval>;
        try {
            captured = captureManagerServiceRemoval(previousSpec, host);
        } catch {
            throw failure("SERVICE_FILES_INVALID");
        }
        try {
            let initial;
            try {
                initial = await platform.inspect();
            } catch {
                throw failure("PLATFORM_INITIAL_INVALID");
            }
            if (
                initial.definitionPath !== files.definition ||
                (initial.state === "running"
                    ? !initial.running || !initial.identity || initial.processId === null
                    : initial.state !== "stopped" ||
                      initial.running ||
                      initial.processId !== null ||
                      !initial.quiescent)
            )
                throw failure("PLATFORM_INITIAL_INVALID");
            let confirmed;
            try {
                confirmed = await platform.inspect();
            } catch {
                throw failure("PLATFORM_UNSTABLE");
            }
            if (!isDeepStrictEqual(initial, confirmed)) throw failure("PLATFORM_UNSTABLE");
            if (!captured.verifyRemaining()) throw failure("SERVICE_FILES_CHANGED");
            transactionEntered = true;
            return await runManagerServiceUpgrade(
                {
                    id: value.id,
                    action: "upgrade",
                    desiredEnabled: initial.enabled,
                    spec,
                    upgrade: {
                        previousSpec,
                        previousCandidateDigest: previousDigest,
                        candidateDigest: value.candidateDigest,
                        snapshot: {
                            platform: host.platform,
                            files: captured.snapshot,
                            initial: {
                                enabled: initial.enabled,
                                processId: initial.processId,
                                identity: initial.identity,
                            },
                        },
                    },
                },
                journal,
                createManagerServiceUpgradeNativePort(host, { ...dependencies, platform }),
            );
        } finally {
            captured.dispose();
        }
    } catch (error) {
        operationFailed = true;
        if (!transactionEntered && !(error instanceof ManagerServiceUpgradeRejectedError))
            throw failure();
        throw error;
    } finally {
        let releaseFailed = false;
        // 单个释放失败不能跳过其余锁，也不能覆盖原事务的中断语义。
        for (const release of [...releases.reverse(), releaseService]) {
            try {
                release();
            } catch {
                releaseFailed = true; /* 统一报告，避免暴露锁数据库路径和底层错误。 */
            }
        }
        if (releaseFailed && !operationFailed)
            throw new Error("管理服务升级已完成，但锁释放未确认；请核对原操作结果，禁止重复升级");
    }
}
