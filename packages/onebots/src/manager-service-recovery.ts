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
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { inspectMigrationManager } from "./service-migration-manager.js";
import { assertServiceAbsent } from "./service-platform-presence.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { verifyServiceMigrationProcessesWhileLocked } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import type { ServicePlatform } from "./service-platform.js";
import type { ServiceScope } from "./service-definition.js";

export interface ManagerServiceRecoveryDependencies {
    platform?: ServicePlatform;
    confirmStopped?: typeof verifyServiceMigrationProcessesWhileLocked;
    inspectManager?: typeof inspectMigrationManager;
}
const failure = () => new Error("尚不能证明原操作已完成，保留恢复记录；未重放系统动作");

function absent(file: string): void {
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
function existingWorkspace(workspace: string): void {
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
        !["linux", "darwin"].includes(host.platform) ||
        (scope === "system" && host.uid !== 0)
    )
        throw failure();
    const files = getServiceFiles(scope, host);
    const release = acquireServiceMigrationLock(files.stateDir);
    try {
        if (inspectServiceMigrationRecovery(files.stateDir)) throw failure();
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
        );
        const record = journal.recoverable(id);
        if (record.managerSpec.scope === scope && record.action === "upgrade") {
            existingWorkspace(record.managerSpec.workspace);
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
        existingWorkspace(spec.workspace);
        assertNoPendingManagerUpgrade(spec.workspace);
        if (readServiceMigrationPending(spec.workspace)) throw failure();
        if (record.action === "start") {
            const captured = captureManagerServiceRemoval(spec, host);
            try {
                const platform =
                    dependencies.platform ??
                    (host.platform === "linux"
                        ? new SystemdServicePlatform(host, scope, files.definition)
                        : new LaunchdServicePlatform(host, scope, files.definition));
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
                const manager = await (dependencies.inspectManager ?? inspectMigrationManager)(
                    spec.workspace,
                );
                const after = await platform.inspect();
                if (
                    manager.manager.pid !== before.processId ||
                    !isDeepStrictEqual(before, after) ||
                    !captured.verifyRemaining()
                )
                    throw failure();
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
            releaseWorkspace = acquireControlWorkspace(spec.workspace);
            const confirm =
                dependencies.confirmStopped ?? verifyServiceMigrationProcessesWhileLocked;
            if (!(await confirm(spec.workspace))) throw failure();
            if (record.action === "uninstall") {
                if (
                    record.removal?.platform !== host.platform ||
                    record.removal.files.definition.path !== files.definition ||
                    record.removal.files.metadata.path !== files.metadata
                )
                    throw failure();
                const verify = () => {
                    absent(files.definition);
                    absent(files.metadata);
                    assertServiceAbsent(scope, host);
                };
                verify();
                if (!(await confirm(spec.workspace))) throw failure();
                verify();
            } else {
                const captured = captureManagerServiceRemoval(spec, host);
                try {
                    const platform =
                        dependencies.platform ??
                        (host.platform === "linux"
                            ? new SystemdServicePlatform(host, scope, files.definition)
                            : new LaunchdServicePlatform(host, scope, files.definition, {
                                  confirmUnloadedProcesses: () => confirm(spec.workspace),
                              }));
                    const before = await platform.inspect();
                    if (
                        before.state !== "stopped" ||
                        before.running ||
                        !before.quiescent ||
                        before.processId !== null ||
                        before.enabled !== record.desiredEnabled ||
                        before.definitionPath !== files.definition ||
                        !(await confirm(spec.workspace)) ||
                        !isDeepStrictEqual(before, await platform.inspect()) ||
                        !captured.verifyRemaining()
                    )
                        throw failure();
                } finally {
                    captured.dispose();
                }
            }
            assertNoPendingManagerUpgrade(spec.workspace);
            if (readServiceMigrationPending(spec.workspace)) throw failure();
            candidate?.verify();
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
