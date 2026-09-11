import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { bundledRuntimeArtifacts } from "./installation/bundled-runtime-artifacts.js";
import { bootstrapManagerServiceWhileLocked } from "./manager-service-bootstrap.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { uninstallManagerServiceWhileLocked } from "./manager-service-uninstall.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { getServiceFiles, writePrivateJson } from "./service-files.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { LegacyServiceInspection } from "./legacy-service-inspection.js";
import { WindowsServicePlatform } from "./service-platform-windows.js";
import { ServiceOperationStorage } from "./service-operation-storage.js";
import {
    createLegacyWindowsScmSnapshot,
    type LegacyWindowsScmCapture,
} from "./service-migration-windows-scm-binding.js";
import {
    legacyWindowsSystemFiles,
    legacyWindowsWrapperPath,
} from "./service-migration-windows-legacy-contract.js";
import type { LegacyWindowsScmSnapshot } from "./service-migration-windows-scm-snapshot.js";
import {
    inspectLegacyWindowsScm,
    requestWindowsLegacyReboot,
    windowsMigrationHostExecutable,
    type WindowsLegacyRebootBinding,
    type WindowsLegacyRebootOperation,
} from "./service-migration-windows-reboot-client.js";
import type { ServiceHost } from "./service-host.js";
import {
    secureWindowsServiceDirectory,
    secureWindowsServiceFile,
} from "./windows-service-security.js";
import {
    captureWindowsMigrationSource,
    removeExactWindowsLegacyArtifact,
    removeWindowsMigrationSource,
    restoreWindowsMigrationSource,
    stableWindowsMigrationFile,
} from "./service-migration-windows-files.js";
import {
    WINDOWS_MIGRATION_ACTIVE as ACTIVE,
    archiveRolledBackWindowsMigration as archiveRolledBack,
    parseWindowsMigrationRecord as parseRecord,
    publicWindowsMigrationResult as publicResult,
    readWindowsMigrationRecord as readRecord,
    readWindowsMigrationSnapshot as readSnapshot,
    saveWindowsMigrationRecord as save,
    windowsMigrationOperationDirectory as operationDirectory,
    windowsMigrationStateDirectory as windowsStateDirectory,
    windowsMigrationStorage as windowsStorage,
    type WindowsServiceMigrationRecord as RecordValue,
    type WindowsServiceMigrationResult,
} from "./service-migration-windows-state.js";
export type {
    WindowsServiceMigrationPhase,
    WindowsServiceMigrationResult,
} from "./service-migration-windows-state.js";
const failure = () => new Error("Windows 旧服务迁移状态无法核实，已保留恢复记录");

export function readWindowsServiceMigrationTarget(host: ServiceHost): ManagerServiceSpec | null {
    const paths = getServiceFiles("system", host);
    const directory = windowsStateDirectory(paths.stateDir);
    if (!fs.existsSync(path.join(directory, ACTIVE))) return null;
    const release = acquireServiceMigrationLock(paths.stateDir, host);
    try {
        const record = readRecord(windowsStorage(paths.stateDir, host), paths.stateDir, host);
        return record.phase === "rolled-back" ? null : structuredClone(record.target);
    } finally {
        release();
    }
}

export function readWindowsServiceMigrationResult(
    host: ServiceHost,
): WindowsServiceMigrationResult | null {
    const paths = getServiceFiles("system", host);
    const active = path.join(windowsStateDirectory(paths.stateDir), ACTIVE);
    if (!fs.existsSync(active)) return null;
    const release = acquireServiceMigrationLock(paths.stateDir, host);
    try {
        return publicResult(readRecord(windowsStorage(paths.stateDir, host), paths.stateDir, host));
    } finally {
        release();
    }
}

export async function migrateInstalledWindowsService(
    input: ManagerServiceSpec,
    host: ServiceHost,
    options: { restart?: boolean } = {},
): Promise<WindowsServiceMigrationResult> {
    const target = parseManagerServiceSpec(input);
    assertHost(target, host);
    const paths = getServiceFiles("system", host);
    secureWindowsServiceDirectory(host, paths.stateDir);
    const release = acquireServiceMigrationLock(paths.stateDir, host);
    try {
        const storage = windowsStorage(paths.stateDir, host);
        let record: RecordValue;
        if (storage.has(ACTIVE)) {
            const existing = readRecord(storage, paths.stateDir, host, target);
            if (existing.phase === "rolled-back") {
                archiveRolledBack(paths.stateDir, existing.id, host);
                record = capture(target, host, paths.stateDir, storage);
            } else record = existing;
        } else record = capture(target, host, paths.stateDir, storage);
        const snapshot = readSnapshot(paths.stateDir, record.id, host);
        if (snapshot.digest !== record.snapshotDigest) throw failure();
        const executable = windowsMigrationHostExecutable(record.target.binPath);
        const binding = rebootBinding(record, snapshot);
        if (record.phase === "captured") {
            native(host, executable, binding, "prepare");
            record = save(
                storage,
                {
                    ...record,
                    phase: "awaiting-restart",
                    status: "running",
                    recoveryRequired: false,
                },
                paths.stateDir,
                host,
            );
        }
        if (record.phase === "awaiting-restart") {
            const inspected = native(host, executable, binding, "inspect");
            if (!inspected.restorationReady) {
                if (options.restart) native(host, executable, binding, "restart");
                return publicResult(record);
            }
            record = save(
                storage,
                {
                    ...record,
                    phase: "restoration-ready",
                    restorationReady: true,
                    status: "running",
                    recoveryRequired: false,
                },
                paths.stateDir,
                host,
            );
        }
        if (["restoration-ready", "manager-installing"].includes(record.phase)) {
            record = await installManager(record, host, paths.stateDir, storage);
            if (record.status === "interrupted") return publicResult(record);
        }
        const platform = new WindowsServicePlatform(host, "system", paths.definition);
        if (record.phase === "manager-ready") {
            await restoreTargetIntent(snapshot, platform);
            record = save(
                storage,
                {
                    ...record,
                    phase: "committing",
                    restorationReady: false,
                },
                paths.stateDir,
                host,
            );
        }
        if (record.phase === "committing") {
            native(host, executable, binding, "commit");
            record = save(
                storage,
                { ...record, phase: "removing-legacy-files" },
                paths.stateDir,
                host,
            );
        }
        if (record.phase === "removing-legacy-files") {
            for (const artifact of Object.values(snapshot.files))
                removeExactWindowsLegacyArtifact(artifact);
            record = save(storage, { ...record, phase: "cleaning" }, paths.stateDir, host);
        }
        if (record.phase === "cleaning") {
            native(host, executable, binding, "cleanup");
            record = save(
                storage,
                {
                    ...record,
                    phase: "completed",
                    status: "succeeded",
                    recoveryRequired: false,
                    restorationReady: false,
                },
                paths.stateDir,
                host,
            );
        }
        return publicResult(record);
    } catch {
        try {
            const storage = windowsStorage(paths.stateDir, host);
            if (storage.has(ACTIVE)) {
                const current = readRecord(storage, paths.stateDir, host, target);
                if (!["completed", "rolled-back"].includes(current.phase))
                    save(
                        storage,
                        {
                            ...current,
                            status: "interrupted",
                            recoveryRequired: true,
                        },
                        paths.stateDir,
                        host,
                    );
            }
        } catch {
            // 原记录仍是恢复门禁；不以第二次写入失败覆盖事实。
        }
        throw failure();
    } finally {
        release();
    }
}

/** recover --rollback-migration 使用；已有 manager 操作时拒绝盲卸载。 */
export async function rollbackWindowsServiceMigration(
    id: string,
    host: ServiceHost,
): Promise<WindowsServiceMigrationResult> {
    const paths = getServiceFiles("system", host);
    const release = acquireServiceMigrationLock(paths.stateDir, host);
    try {
        const storage = windowsStorage(paths.stateDir, host);
        const record = readRecord(storage, paths.stateDir, host);
        if (
            record.id !== id ||
            ["committing", "removing-legacy-files", "cleaning", "completed"].includes(record.phase)
        )
            throw failure();
        const managerJournal = path.join(paths.stateDir, "manager-operations", `${id}.json`);
        if (fs.existsSync(managerJournal)) {
            const manager = new FileManagerServiceJournal(
                path.join(paths.stateDir, "manager-operations"),
            ).read(id);
            if (manager.status !== "succeeded" || manager.recoveryRequired) throw failure();
            const rollbackId = `rollback_${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
            const rollbackFile = path.join(
                paths.stateDir,
                "manager-operations",
                `${rollbackId}.json`,
            );
            const removed = fs.existsSync(rollbackFile)
                ? new FileManagerServiceJournal(
                      path.join(paths.stateDir, "manager-operations"),
                  ).read(rollbackId)
                : await uninstallManagerServiceWhileLocked("system", host, rollbackId);
            if (removed.status !== "succeeded" || removed.recoveryRequired) throw failure();
        }
        let current = save(storage, { ...record, phase: "rolling-back" }, paths.stateDir, host);
        restoreWindowsMigrationSource(paths.stateDir, current.id, host);
        const snapshot = readSnapshot(paths.stateDir, current.id, host);
        native(
            host,
            windowsMigrationHostExecutable(current.target.binPath),
            rebootBinding(current, snapshot),
            "rollback",
        );
        current = save(
            storage,
            {
                ...current,
                phase: "rolled-back",
                status: "failed",
                recoveryRequired: false,
                restorationReady: false,
            },
            paths.stateDir,
            host,
        );
        return publicResult(current);
    } finally {
        release();
    }
}

async function installManager(
    input: RecordValue,
    host: ServiceHost,
    stateDirectory: string,
    storage: ServiceOperationStorage,
): Promise<RecordValue> {
    let record = input;
    const operations = path.join(stateDirectory, "manager-operations");
    const operationFile = path.join(operations, `${record.id}.json`);
    if (!fs.existsSync(operationFile)) {
        record = save(storage, { ...record, phase: "manager-installing" }, stateDirectory, host);
        removeWindowsMigrationSource(stateDirectory, record.id, host);
        const result = await bootstrapManagerServiceWhileLocked(
            {
                id: record.id,
                service: {
                    schemaVersion: 1,
                    runtimeKind: "control",
                    scope: "system",
                    workspace: record.target.workspace,
                    nodePath: record.target.nodePath,
                    host: record.target.host,
                    port: record.target.port,
                },
            },
            { artifacts: bundledRuntimeArtifacts() },
            host,
        );
        if (result.status !== "succeeded" || result.recoveryRequired)
            return save(
                storage,
                {
                    ...record,
                    status: "interrupted",
                    recoveryRequired: true,
                },
                stateDirectory,
                host,
            );
    }
    const manager = new FileManagerServiceJournal(operations).read(record.id);
    if (manager.status !== "succeeded" || manager.recoveryRequired)
        return save(
            storage,
            {
                ...record,
                status: "interrupted",
                recoveryRequired: true,
            },
            stateDirectory,
            host,
        );
    if (manager.managerSpec.workspace !== record.target.workspace) throw failure();
    return save(
        storage,
        { ...record, phase: "manager-ready", status: "running" },
        stateDirectory,
        host,
    );
}

async function restoreTargetIntent(
    snapshot: LegacyWindowsScmSnapshot,
    platform: WindowsServicePlatform,
): Promise<void> {
    const enabled = snapshot.inspection.configuration.startType === 2;
    const stopped = await platform.reload(enabled);
    if (snapshot.inspection.state === "running") await platform.start(stopped);
    const first = await platform.inspect();
    const second = await platform.inspect();
    if (
        !isDeepStrictEqual(first, second) ||
        first.enabled !== enabled ||
        (snapshot.inspection.state === "running"
            ? first.state !== "running" || !first.identity
            : first.state !== "stopped" || !first.quiescent)
    )
        throw failure();
}

function capture(
    target: ManagerServiceSpec,
    host: ServiceHost,
    stateDirectory: string,
    storage: ServiceOperationStorage,
): RecordValue {
    const legacy = new LegacyServiceInspection("system", host).readSpec();
    if (!legacy) throw failure();
    const id = randomUUID();
    const files = legacyWindowsSystemFiles(legacy, stateDirectory);
    const definition = stableWindowsMigrationFile(files.definition, 64 * 1024);
    const executable = stableWindowsMigrationFile(files.executable, 256 * 1024 * 1024);
    const runner = stableWindowsMigrationFile(files.runner, 64 * 1024);
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(definition.bytes);
    const input: LegacyWindowsScmCapture = {
        operationId: id,
        spec: legacy,
        stateDirectory,
        wrapperPath: legacyWindowsWrapperPath(xml, legacy, stateDirectory),
        inspection: inspectLegacyWindowsScm(host, windowsMigrationHostExecutable(target.binPath)),
        files: { definition: definition.bytes, executable: executable.bytes, runner: runner.bytes },
    };
    const snapshot = createLegacyWindowsScmSnapshot(input);
    const directory = operationDirectory(stateDirectory, id, host);
    writePrivateJson(path.join(directory, "snapshot.json"), snapshot);
    secureWindowsServiceFile(host, path.join(directory, "snapshot.json"));
    captureWindowsMigrationSource(directory, host);
    const record: RecordValue = {
        schemaVersion: 1,
        id,
        phase: "captured",
        status: "running",
        recoveryRequired: false,
        restorationReady: false,
        nonce: randomBytes(32).toString("hex"),
        snapshotDigest: snapshot.digest,
        target,
    };
    return parseRecord(save(storage, record, stateDirectory, host, true), target);
}

function assertHost(target: ManagerServiceSpec, host: ServiceHost): void {
    if (
        host.platform !== "win32" ||
        host.isElevated !== true ||
        target.scope !== "system" ||
        typeof host.windowsSid !== "string"
    )
        throw new Error("Windows 旧服务迁移只支持管理员 system 范围");
}
function rebootBinding(
    record: RecordValue,
    snapshot: LegacyWindowsScmSnapshot,
): WindowsLegacyRebootBinding {
    return {
        operationId: record.id,
        stateDirectory: snapshot.stateDirectory,
        snapshotDigest: snapshot.digest,
        nonce: record.nonce,
        expected: snapshot.inspection,
    };
}
function native(
    host: ServiceHost,
    executable: string,
    binding: WindowsLegacyRebootBinding,
    operation: WindowsLegacyRebootOperation,
) {
    return requestWindowsLegacyReboot(host, executable, binding, operation);
}
