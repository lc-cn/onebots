import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLocalControlTransport } from "./client/local-control.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { FileManagerServiceJournal, type ManagerServiceRecord } from "./manager-service-journal.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { managerCandidateDigest, readRunningManagerCandidate } from "./manager-runtime/identity.js";
import { getServiceFiles } from "./service-files.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { inspectMigrationManager } from "./service-migration-manager.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import {
    verifyServiceMigrationProcesses,
    verifyServiceMigrationProcessesWhileLocked,
} from "./service-migration-processes.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import type { ServicePlatform } from "./service-platform.js";
import {
    completeRolledBackManagerUpgradeWhileLocked,
    readManagerUpgradePending,
} from "./service-upgrade-workspace.js";
import type { ServiceScope } from "./service-definition.js";

const failure = () => new Error("管理程序升级回退现场无法确认，保留恢复门禁；未重复派发系统动作");
const rollbackPhases = [
    "rollback-stopping",
    "rollback-writing",
    "rollback-reloading",
    "rollback-starting",
    "rollback-verifying",
] as const;

export interface ManagerUpgradeRollbackDependencies {
    platform?: ServicePlatform;
    inspectManager?: typeof inspectMigrationManager;
    readinessTimeoutMs?: number;
}

/**
 * 显式恢复被替换的已验证管理候选。每个阶段先写意图，再依据当前 OS 和文件事实决定
 * 是否需要派发一次效果；结果未知且无法证明目标已达到时保持当前阶段封锁。
 */
export async function rollbackManagerServiceUpgrade(
    id: string,
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerUpgradeRollbackDependencies = {},
): Promise<ManagerServiceRecord> {
    if (
        typeof id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        !["user", "system"].includes(scope) ||
        !["linux", "darwin"].includes(host.platform) ||
        (scope === "system" && host.uid !== 0)
    )
        throw failure();
    const timeout = dependencies.readinessTimeoutMs ?? 120_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw failure();
    const files = getServiceFiles(scope, host);
    const releaseService = acquireServiceMigrationLock(files.stateDir);
    const releases: Array<() => void> = [];
    let releaseWorkspace: (() => void) | undefined;
    try {
        const journal = new FileManagerServiceJournal(
            path.join(files.stateDir, "manager-operations"),
        );
        let record = journal.recoverable(id);
        if (record.action !== "upgrade" || !record.upgrade || record.managerSpec.scope !== scope)
            throw failure();
        const previous = readRunningManagerCandidate(
            pathToFileURL(
                path.join(path.dirname(record.upgrade.previousSpec.binPath), "control/host.js"),
            ).href,
        );
        const target = readRunningManagerCandidate(
            pathToFileURL(path.join(path.dirname(record.managerSpec.binPath), "control/host.js"))
                .href,
        );
        for (const home of [
            ...new Set(
                [previous.directory, target.directory].map(directory =>
                    path.dirname(path.dirname(directory)),
                ),
            ),
        ].sort()) {
            if (fs.realpathSync(home) !== home || home === record.managerSpec.workspace)
                throw failure();
            releases.push(acquireControlWorkspace(home));
        }
        verify(record, previous, target);
        if (readServiceMigrationPending(record.managerSpec.workspace)) throw failure();
        const driver =
            dependencies.platform ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, scope, files.definition)
                : new LaunchdServicePlatform(host, scope, files.definition, {
                      confirmUnloadedProcesses: () =>
                          releaseWorkspace
                              ? verifyServiceMigrationProcessesWhileLocked(
                                    record.managerSpec.workspace,
                                )
                              : verifyServiceMigrationProcesses(record.managerSpec.workspace),
                  }));
        if (
            record.phase === "completed" &&
            record.status === "failed" &&
            !record.recoveryRequired
        ) {
            await verifyRolledBack(record, driver, previous, dependencies.inspectManager, timeout);
            return record;
        }
        if (
            record.status !== "interrupted" ||
            !record.recoveryRequired ||
            !["restoring-enablement", "starting", "verifying", ...rollbackPhases].includes(
                record.phase as (typeof rollbackPhases)[number],
            )
        )
            throw failure();
        if (["rollback-writing", "rollback-reloading"].includes(record.phase))
            releaseWorkspace = acquireControlWorkspace(record.managerSpec.workspace);
        if (!rollbackPhases.includes(record.phase as (typeof rollbackPhases)[number])) {
            record = advance(journal, record, "rollback-stopping");
        }
        if (record.phase === "rollback-stopping") {
            pending(record);
            assertFiles(record.managerSpec, host);
            const before = await driver.inspect();
            // 失败候选可能被 OS 自动重启，但在控制 socket 建立前再次退出。服务定义路径、
            // 候选摘要和回退阶段已共同绑定目标；停机仍由平台驱动核验同一 OS 服务实例，
            // 不能反过来依赖正是故障点的应用层自报接口。
            if (before.running || before.enabled || before.state === "failed" || !before.quiescent)
                await driver.quiesce();
            await assertQuiet(driver, false);
            releaseWorkspace = acquireControlWorkspace(record.managerSpec.workspace);
            record = advance(journal, record, "rollback-writing");
        }
        let enteredReloading = false;
        let enteredStarting = false;
        if (record.phase === "rollback-writing") {
            pending(record);
            if (!filesMatch(record.upgrade.previousSpec, host)) {
                restorePreviousManagerServiceFiles(record, host);
            }
            assertFiles(record.upgrade.previousSpec, host);
            record = advance(journal, record, "rollback-reloading");
            enteredReloading = true;
        }
        if (record.phase === "rollback-reloading") {
            assertFiles(record.upgrade.previousSpec, host);
            const before = await driver.inspect();
            const alreadyReloaded =
                before.state === "stopped" &&
                !before.running &&
                before.quiescent &&
                before.enabled === record.desiredEnabled;
            const marker = readManagerUpgradePending(record.managerSpec.workspace);
            if (marker?.phase === "released") {
                rolledBackMarker(record);
                if (!alreadyReloaded) throw failure();
            } else {
                const expected = pending(record);
                if (!alreadyReloaded) {
                    // Only the invocation which just durably entered this phase may dispatch reload.
                    // On cold re-entry an unsatisfied state has an unknown prior outcome, so block.
                    if (!enteredReloading || before.running || !before.quiescent) throw failure();
                    const reloaded = await driver.reload(record.desiredEnabled);
                    if (
                        reloaded.state !== "stopped" ||
                        reloaded.running ||
                        !reloaded.quiescent ||
                        reloaded.enabled !== record.desiredEnabled
                    )
                        throw failure();
                }
                completeRolledBackManagerUpgradeWhileLocked(record.managerSpec.workspace, expected);
            }
            record = advance(journal, record, "rollback-starting");
            enteredStarting = true;
        }
        if (record.phase === "rollback-starting") {
            rolledBackMarker(record);
            assertFiles(record.upgrade.previousSpec, host);
            releaseWorkspace?.();
            releaseWorkspace = undefined;
            if (record.upgrade.snapshot.initial.processId !== null) {
                const before = await driver.inspect();
                if (before.running) {
                    // A previously dispatched start is accepted only after proving old identity.
                    await verifyRolledBack(
                        record,
                        driver,
                        previous,
                        dependencies.inspectManager,
                        timeout,
                    );
                } else {
                    // A cold rollback-starting record cannot distinguish "not dispatched" from
                    // "dispatched then failed". Never replay the external start in that state.
                    if (!enteredStarting) throw failure();
                    await driver.start(before);
                }
            }
            record = advance(journal, record, "rollback-verifying");
        }
        if (record.phase === "rollback-verifying") {
            await verifyRolledBack(record, driver, previous, dependencies.inspectManager, timeout);
            const completed = {
                ...record,
                phase: "completed" as const,
                status: "failed" as const,
                recoveryRequired: false,
            };
            journal.save(completed);
            return journal.read(id);
        }
        throw failure();
    } catch (error) {
        if (error instanceof Error && error.message === failure().message) throw error;
        throw failure();
    } finally {
        try {
            releaseWorkspace?.();
        } catch {
            // 未确认释放时仍继续释放工件锁与服务锁，持久阶段保持封锁。
        }
        for (const release of releases.reverse()) {
            try {
                release();
            } catch {
                // 所有锁仍逐一尝试释放，原升级记录保留为唯一恢复事实。
            }
        }
        releaseService();
    }
}

function advance(
    journal: FileManagerServiceJournal,
    record: ManagerServiceRecord,
    phase: ManagerServiceRecord["phase"],
): ManagerServiceRecord {
    const next = { ...record, phase };
    journal.save(next);
    return journal.read(record.id);
}

function verify(
    record: ManagerServiceRecord,
    previous: ReturnType<typeof readRunningManagerCandidate>,
    target: ReturnType<typeof readRunningManagerCandidate>,
): void {
    if (!record.upgrade) throw failure();
    if (
        managerCandidateDigest(previous) !== record.upgrade.previousCandidateDigest ||
        managerCandidateDigest(target) !== record.upgrade.candidateDigest ||
        previous.directory !== record.upgrade.previousSpec.workingDirectory ||
        target.directory !== record.managerSpec.workingDirectory
    )
        throw failure();
    verifyManagerServiceCandidate(
        record.upgrade.previousSpec,
        record.upgrade.previousCandidateDigest,
    );
    verifyManagerServiceCandidate(record.managerSpec, record.upgrade.candidateDigest);
}

function pending(record: ManagerServiceRecord) {
    const marker = readManagerUpgradePending(record.managerSpec.workspace);
    if (
        !record.upgrade ||
        !marker ||
        marker.phase !== undefined ||
        marker.operationId !== record.id ||
        marker.candidateDigest !== record.upgrade.candidateDigest
    )
        throw failure();
    return marker;
}

function rolledBackMarker(record: ManagerServiceRecord): void {
    const marker = readManagerUpgradePending(record.managerSpec.workspace);
    if (
        !record.upgrade ||
        !marker ||
        marker.phase !== "released" ||
        marker.completion !== "rollback" ||
        marker.operationId !== record.id ||
        marker.candidateDigest !== record.upgrade.candidateDigest
    )
        throw failure();
}

function filesMatch(spec: ManagerServiceRecord["managerSpec"], host: ServiceHost): boolean {
    try {
        assertFiles(spec, host);
        return true;
    } catch {
        return false;
    }
}

function assertFiles(spec: ManagerServiceRecord["managerSpec"], host: ServiceHost): void {
    const captured = captureManagerServiceRemoval(spec, host);
    try {
        if (!captured.verifyRemaining()) throw failure();
    } finally {
        captured.dispose();
    }
}

/** rollback-writing 专用：每个文件只从精确目标字节 CAS 到精确旧字节。 */
export function restorePreviousManagerServiceFiles(
    record: ManagerServiceRecord,
    host: ServiceHost,
): void {
    if (!record.upgrade) throw failure();
    if (
        record.phase !== "rollback-writing" ||
        record.status !== "interrupted" ||
        !record.recoveryRequired ||
        !["linux", "darwin"].includes(host.platform)
    )
        throw failure();
    const files = getServiceFiles(record.managerSpec.scope, host);
    const pairs = [
        {
            key: "definition" as const,
            file: files.definition,
            modes: [0o600, 0o644],
            target: Buffer.from(
                renderInstalledManagerService(
                    record.managerSpec,
                    host.platform as "linux" | "darwin",
                    files.stateDir,
                ),
            ),
            previous: Buffer.from(
                renderInstalledManagerService(
                    record.upgrade.previousSpec,
                    host.platform as "linux" | "darwin",
                    files.stateDir,
                ),
            ),
        },
        {
            key: "metadata" as const,
            file: files.metadata,
            modes: [0o600],
            target: Buffer.from(`${JSON.stringify(record.managerSpec)}\n`),
            previous: Buffer.from(`${JSON.stringify(record.upgrade.previousSpec)}\n`),
        },
    ];
    for (const pair of pairs) {
        const stat = fs.lstatSync(pair.file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            !pair.modes.includes(stat.mode & 0o7777) ||
            (process.getuid && stat.uid !== process.getuid())
        )
            throw failure();
        const file = new ConfigurationFile(pair.file);
        const snapshot = file.readRaw();
        const previousMode = record.upgrade.snapshot.files[pair.key].mode;
        if (snapshot.bytes.equals(pair.previous)) {
            if ((stat.mode & 0o7777) === previousMode) continue;
            // replaceRaw publishes mode 0600 before the old bytes' original mode is restored.
            // This exact intermediate state is resumable; any other mode remains ambiguous.
            if ((stat.mode & 0o7777) !== 0o600) throw failure();
        } else {
            if (!snapshot.bytes.equals(pair.target) || (stat.mode & 0o7777) !== 0o600)
                throw failure();
            file.replaceRaw(snapshot.revision, pair.previous);
        }
        restoreMode(pair.file, pair.previous, previousMode);
    }
    assertFiles(record.upgrade.previousSpec, host);
}

function restoreMode(file: string, expected: Buffer, mode: number): void {
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const before = fs.fstatSync(descriptor);
        const current = fs.lstatSync(file);
        if (
            !before.isFile() ||
            before.nlink !== 1 ||
            before.dev !== current.dev ||
            before.ino !== current.ino ||
            current.isSymbolicLink() ||
            !new ConfigurationFile(file).readRaw().bytes.equals(expected)
        )
            throw failure();
        fs.fchmodSync(descriptor, mode);
        fs.fsyncSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(file);
        if (
            (after.mode & 0o7777) !== mode ||
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            final.dev !== before.dev ||
            final.ino !== before.ino ||
            !new ConfigurationFile(file).readRaw().bytes.equals(expected)
        )
            throw failure();
    } catch {
        throw failure();
    } finally {
        if (descriptor !== undefined) {
            try {
                fs.closeSync(descriptor);
            } catch {
                throw failure();
            }
        }
    }
}

async function assertQuiet(driver: ServicePlatform, enabled: boolean): Promise<void> {
    const first = await driver.inspect();
    const second = await driver.inspect();
    if (
        first.state !== "stopped" ||
        first.running ||
        !first.quiescent ||
        first.processId !== null ||
        first.enabled !== enabled ||
        !isDeepStrictEqual(first, second)
    )
        throw failure();
}

async function verifyRolledBack(
    record: ManagerServiceRecord,
    driver: ServicePlatform,
    previous: ReturnType<typeof readRunningManagerCandidate>,
    inspect: typeof inspectMigrationManager = inspectMigrationManager,
    timeout = 120_000,
): Promise<void> {
    rolledBackMarker(record);
    const deadline = Date.now() + timeout;
    do {
        const before = await driver.inspect();
        if (record.upgrade?.snapshot.initial.processId === null) {
            if (
                before.state === "stopped" &&
                !before.running &&
                before.quiescent &&
                before.enabled === record.desiredEnabled
            )
                return;
        } else if (before.state === "running" && before.processId !== null) {
            try {
                const state = await inspect(record.managerSpec.workspace);
                const identity = await createLocalControlTransport(
                    record.managerSpec.workspace,
                ).request<{ managerId: string; candidateDigest: string }>(
                    "GET",
                    "/api/control/service-upgrade/identity",
                );
                if (
                    state.manager.pid === before.processId &&
                    state.manager.id === identity.managerId &&
                    identity.candidateDigest === managerCandidateDigest(previous) &&
                    state.gateway.actual === state.gateway.desired &&
                    isDeepStrictEqual(before, await driver.inspect())
                )
                    return;
            } catch {
                // 旧 manager 和 gateway 在有界启动窗口内可能尚未完成握手。
            }
        }
        if (Date.now() >= deadline) throw failure();
        await new Promise(resolve => setTimeout(resolve, 250));
    } while (true);
}
