import { captureInstalledManagerCandidate } from "./manager-service-install-recovery.js";
import { verifyReleasedManagerServiceUpgrade } from "./manager-service-upgrade-recovery.js";
import { assertNoPendingManagerUpgrade } from "./service-upgrade-workspace.js";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { FileManagerServiceJournal, type ManagerServiceRecord } from "./manager-service-journal.js";
import { getServiceFiles } from "./service-files.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { inspectServiceMigrationRecovery } from "./service-recovery-inspection.js";
import {
    readServiceMigrationPending,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { inspectMigrationManager } from "./service-migration-manager.js";
import { assertServiceAbsent } from "./service-platform-presence.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { WindowsServicePlatform } from "./service-platform-windows.js";
import { verifyServiceMigrationProcessesWhileLocked } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { readRunningManagerCandidate, managerCandidateDigest } from "./manager-runtime/identity.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { pathToFileURL } from "node:url";
import type { ServicePlatform } from "./service-platform.js";
import type { ServiceScope } from "./service-definition.js";
import { inspectWindowsServiceDirectorySecurity } from "./windows-service-security.js";

export interface ManagerServiceRecoveryDependencies {
    platform?: ServicePlatform;
    confirmStopped?: typeof verifyServiceMigrationProcessesWhileLocked;
    inspectManager?: typeof inspectMigrationManager;
    inspectRuntime?: typeof inspectManagerRuntime;
}
const failure = () => new Error("尚不能证明原操作已完成，保留恢复记录；未重放系统动作");

/** 把在线自报版本绑定到服务定义指向的已验证不可变候选。 */
function inspectManagerRuntime(spec: ManagerServiceRecord["managerSpec"], version: string): string {
    try {
        const candidate = readRunningManagerCandidate(
            pathToFileURL(path.join(path.dirname(spec.binPath), "control/host.js")).href,
        );
        const digest = managerCandidateDigest(candidate);
        const verified = verifyManagerServiceCandidate(spec, digest);
        if (verified.receipt.hostVersion !== version) throw failure();
        return digest;
    } catch {
        throw failure();
    }
}

function absent(file: string, host: ServiceHost): void {
    if (host.platform === "win32") {
        const directory = path.dirname(file);
        const state = fs.lstatSync(directory);
        if (
            !state.isDirectory() ||
            state.isSymbolicLink() ||
            fs.realpathSync(directory) !== directory
        )
            throw failure();
        inspectWindowsServiceDirectorySecurity(host, directory);
        try {
            fs.lstatSync(file);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw failure();
        }
        throw failure();
    }
    for (let current = path.dirname(file); ; current = path.dirname(current)) {
        const stat = fs.lstatSync(current);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (stat.uid !== 0 && stat.uid !== process.getuid?.()) ||
            ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && stat.mode & 0o1000))
        )
            throw failure();
        if (current === path.dirname(current)) break;
    }
    try {
        fs.lstatSync(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    throw failure();
}
function existingWorkspace(workspace: string, host: ServiceHost): void {
    if (host.platform === "win32") {
        const stat = fs.lstatSync(workspace);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            fs.realpathSync(workspace) !== workspace
        )
            throw failure();
        inspectWindowsServiceDirectorySecurity(host, workspace);
        return;
    }
    if (fs.realpathSync(workspace) !== workspace) throw failure();
    for (const directory of [workspace, path.join(workspace, ".control")]) {
        const stat = fs.lstatSync(directory);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            stat.uid !== process.getuid?.() ||
            (stat.mode & (directory === workspace ? 0o022 : 0o077)) !== 0
        )
            throw failure();
    }
}

/** 本机显式对账：只确认已达到的 start/stop/uninstall、已完成安装或已释放升级，不重放未知动作。 */
export async function reconcileManagerServiceOperation(
    id: string,
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerServiceRecoveryDependencies = {},
): Promise<ManagerServiceRecord> {
    if (
        typeof id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        !["user", "system"].includes(scope) ||
        !["linux", "darwin", "win32"].includes(host.platform) ||
        (host.platform === "win32"
            ? scope !== "system" || host.isElevated !== true
            : scope === "system" && host.uid !== 0)
    )
        throw failure();
    const files = getServiceFiles(scope, host);
    const release = acquireServiceMigrationLock(files.stateDir, host);
    try {
        if (inspectServiceMigrationRecovery(files.stateDir)) throw failure();
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
        );
        const record = journal.recoverable(id);
        if (record.managerSpec.scope === scope && record.action === "upgrade") {
            existingWorkspace(record.managerSpec.workspace, host);
            await verifyReleasedManagerServiceUpgrade(record, host, dependencies.platform);
            const completed: ManagerServiceRecord = {
                ...record,
                phase: "completed",
                status: "succeeded",
                recoveryRequired: false,
            };
            journal.save(completed);
            return journal.read(id);
        }
        if (
            record.managerSpec.scope !== scope ||
            !["start", "stop", "uninstall", "install"].includes(record.action)
        )
            throw failure();
        const spec = record.managerSpec;
        existingWorkspace(spec.workspace, host);
        assertNoPendingManagerUpgrade(spec.workspace);
        if (record.action !== "install" && readServiceMigrationPending(spec.workspace))
            throw failure();
        if (record.action === "start") {
            const captured = captureManagerServiceRemoval(spec, host);
            try {
                const platform =
                    dependencies.platform ??
                    (host.platform === "linux"
                        ? new SystemdServicePlatform(host, scope, files.definition)
                        : host.platform === "darwin"
                          ? new LaunchdServicePlatform(host, scope, files.definition)
                          : new WindowsServicePlatform(host, scope, files.definition));
                const before = await platform.inspect();
                if (
                    before.state !== "running" ||
                    !before.running ||
                    !before.loaded ||
                    before.enabled !== record.desiredEnabled ||
                    before.processId === null ||
                    before.identity === null ||
                    before.definitionPath !== files.definition ||
                    !captured.verifyRemaining()
                )
                    throw failure();
                const inspectRuntime = dependencies.inspectRuntime ?? inspectManagerRuntime;
                if (host.platform === "win32") {
                    const windows = platform as WindowsServicePlatform;
                    const nativeBefore = await windows.inspectNative();
                    const manager = nativeBefore.control?.manager;
                    if (!manager || manager.pid !== before.processId) throw failure();
                    const runtime = inspectRuntime(spec, manager.version);
                    if (
                        !isDeepStrictEqual(nativeBefore, await windows.inspectNative()) ||
                        inspectRuntime(spec, manager.version) !== runtime ||
                        !captured.verifyRemaining()
                    )
                        throw failure();
                } else {
                    const manager = await (dependencies.inspectManager ?? inspectMigrationManager)(
                        spec.workspace,
                    );
                    const runtime = inspectRuntime(spec, manager.manager.version);
                    const after = await platform.inspect();
                    if (
                        manager.manager.pid !== before.processId ||
                        !isDeepStrictEqual(before, after) ||
                        inspectRuntime(spec, manager.manager.version) !== runtime ||
                        !captured.verifyRemaining()
                    )
                        throw failure();
                }
            } finally {
                captured.dispose();
            }
            assertNoPendingManagerUpgrade(spec.workspace);
            if (readServiceMigrationPending(spec.workspace)) throw failure();
            const completed: ManagerServiceRecord = {
                ...record,
                phase: "completed",
                status: "succeeded",
                recoveryRequired: false,
            };
            journal.save(completed);
            return completed;
        }
        const candidate =
            record.action === "install"
                ? captureInstalledManagerCandidate(record, host)
                : undefined;
        let releaseWorkspace: (() => void) | undefined;
        try {
            releaseWorkspace = acquireControlWorkspace(spec.workspace, host);
            const pending = readServiceMigrationPending(spec.workspace);
            const installMayHaveGate =
                record.action === "install" &&
                ["restoring-enablement", "verifying", "releasing"].includes(record.phase);
            const releaseInstallGate = installMayHaveGate && pending !== null;
            if (
                (pending &&
                    (!installMayHaveGate ||
                        pending.operationId !== record.id ||
                        pending.desired !== "running")) ||
                (!pending && installMayHaveGate && record.phase !== "releasing")
            )
                throw failure();
            const platform =
                dependencies.platform ??
                (host.platform === "linux"
                    ? new SystemdServicePlatform(host, scope, files.definition)
                    : host.platform === "darwin"
                      ? new LaunchdServicePlatform(host, scope, files.definition)
                      : record.action === "uninstall"
                        ? undefined
                        : new WindowsServicePlatform(host, scope, files.definition));
            const confirm =
                dependencies.confirmStopped ??
                (host.platform === "win32"
                    ? async () => {
                          if (record.action === "uninstall") {
                              assertServiceAbsent(scope, host);
                              return true;
                          }
                          const state = await platform!.inspect();
                          return (
                              state.state === "stopped" &&
                              !state.running &&
                              state.quiescent &&
                              state.processId === null
                          );
                      }
                    : verifyServiceMigrationProcessesWhileLocked);
            if (!(await confirm(spec.workspace))) throw failure();
            if (record.action === "uninstall") {
                if (
                    record.removal?.platform !== host.platform ||
                    record.removal.files.definition.path !== files.definition ||
                    record.removal.files.metadata.path !== files.metadata
                )
                    throw failure();
                const verify = () => {
                    if (host.platform === "win32")
                        inspectWindowsServiceDirectorySecurity(host, files.stateDir);
                    absent(files.definition, host);
                    absent(files.metadata, host);
                    assertServiceAbsent(scope, host);
                };
                verify();
                if (!(await confirm(spec.workspace))) throw failure();
                verify();
            } else {
                const captured = captureManagerServiceRemoval(spec, host);
                try {
                    const stoppedPlatform =
                        host.platform === "darwin"
                            ? new LaunchdServicePlatform(host, scope, files.definition, {
                                  confirmUnloadedProcesses: () => confirm(spec.workspace),
                              })
                            : platform!;
                    const before = await stoppedPlatform.inspect();
                    if (
                        before.state !== "stopped" ||
                        before.running ||
                        !before.quiescent ||
                        before.processId !== null ||
                        before.enabled !== record.desiredEnabled ||
                        before.definitionPath !== files.definition ||
                        !(await confirm(spec.workspace)) ||
                        !isDeepStrictEqual(before, await stoppedPlatform.inspect()) ||
                        !captured.verifyRemaining()
                    )
                        throw failure();
                } finally {
                    captured.dispose();
                }
            }
            assertNoPendingManagerUpgrade(spec.workspace);
            candidate?.verify();
            if (releaseInstallGate) {
                const current = readServiceMigrationPending(spec.workspace);
                if (!current || current.operationId !== record.id || current.desired !== "running")
                    throw failure();
                candidate?.verify();
                releaseServiceMigrationPending(spec.workspace, record.id);
                if (readServiceMigrationPending(spec.workspace) !== null) throw failure();
                candidate?.verify();
            }
            // 保留原 ID 和意图；完成记录也必须重新核验，不能凭旧成功跳过现场。
            const completed: ManagerServiceRecord = {
                ...record,
                phase: "completed",
                status: "succeeded",
                recoveryRequired: false,
            };
            journal.save(completed);
            return completed;
        } finally {
            try {
                releaseWorkspace?.();
            } finally {
                candidate?.dispose();
            }
        }
    } finally {
        release();
    }
}
