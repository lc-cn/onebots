import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import {
    parseLegacyWindowsScmSnapshot,
    type LegacyWindowsScmSnapshot,
} from "./service-migration-windows-scm-snapshot.js";
import { stableWindowsMigrationFile } from "./service-migration-windows-files.js";
import type { ServiceHost } from "./service-host.js";
import {
    inspectWindowsServiceFileSecurity,
    secureWindowsServiceDirectory,
    secureWindowsServiceFile,
} from "./windows-service-security.js";

export type WindowsServiceMigrationPhase =
    | "captured"
    | "awaiting-restart"
    | "restoration-ready"
    | "manager-installing"
    | "manager-ready"
    | "committing"
    | "removing-legacy-files"
    | "cleaning"
    | "completed"
    | "rolling-back"
    | "rolled-back";
export interface WindowsServiceMigrationResult {
    id: string;
    phase: WindowsServiceMigrationPhase;
    status: "running" | "succeeded" | "failed" | "interrupted";
    recoveryRequired: boolean;
    restorationReady: boolean;
    rolledBack: boolean;
}
export interface WindowsServiceMigrationRecord extends Omit<
    WindowsServiceMigrationResult,
    "rolledBack"
> {
    schemaVersion: 1;
    nonce: string;
    snapshotDigest: string;
    target: ManagerServiceSpec;
}
export const WINDOWS_MIGRATION_ACTIVE = "active.json";
const failure = () => new Error("Windows 旧服务迁移状态无法核实，已保留恢复记录");

export function windowsMigrationStorage(
    stateDirectory: string,
    host: ServiceHost,
): ServiceOperationStorage {
    secureWindowsServiceDirectory(host, windowsMigrationRootDirectory(stateDirectory));
    const directory = windowsMigrationStateDirectory(stateDirectory);
    secureWindowsServiceDirectory(host, directory);
    return new ServiceOperationStorage(directory);
}
export function archiveRolledBackWindowsMigration(
    stateDirectory: string,
    id: string,
    host: ServiceHost,
): void {
    const directory = windowsMigrationStateDirectory(stateDirectory);
    const active = path.join(directory, WINDOWS_MIGRATION_ACTIVE);
    const archived = path.join(directory, `${id}.json`);
    if (fs.existsSync(archived)) throw failure();
    inspectWindowsServiceFileSecurity(host, active);
    fs.renameSync(active, archived);
    inspectWindowsServiceFileSecurity(host, archived);
}
export function windowsMigrationOperationDirectory(
    stateDirectory: string,
    id: string,
    host: ServiceHost,
): string {
    const root = windowsMigrationRootDirectory(stateDirectory);
    secureWindowsServiceDirectory(host, root);
    const operations = path.join(root, "operations");
    secureWindowsServiceDirectory(host, operations);
    const directory = path.join(operations, id);
    secureWindowsServiceDirectory(host, directory);
    return directory;
}
export function readWindowsMigrationSnapshot(
    stateDirectory: string,
    id: string,
    host: ServiceHost,
): LegacyWindowsScmSnapshot {
    const file = path.join(stateDirectory, "windows-migration", "operations", id, "snapshot.json");
    inspectWindowsServiceFileSecurity(host, file);
    const stable = stableWindowsMigrationFile(file, 1024 * 1024);
    return parseLegacyWindowsScmSnapshot(JSON.parse(stable.bytes.toString("utf8")));
}
export function parseWindowsMigrationRecord(
    input: unknown,
    target?: ManagerServiceSpec,
): WindowsServiceMigrationRecord {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "id",
        "phase",
        "status",
        "recoveryRequired",
        "restorationReady",
        "nonce",
        "snapshotDigest",
        "target",
    ]);
    const parsedTarget = parseManagerServiceSpec(value.target);
    if (
        value.schemaVersion !== 1 ||
        typeof value.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
        typeof value.phase !== "string" ||
        ![
            "captured",
            "awaiting-restart",
            "restoration-ready",
            "manager-installing",
            "manager-ready",
            "committing",
            "removing-legacy-files",
            "cleaning",
            "completed",
            "rolling-back",
            "rolled-back",
        ].includes(value.phase) ||
        typeof value.status !== "string" ||
        !["running", "succeeded", "failed", "interrupted"].includes(value.status) ||
        typeof value.recoveryRequired !== "boolean" ||
        typeof value.restorationReady !== "boolean" ||
        typeof value.nonce !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.nonce) ||
        typeof value.snapshotDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.snapshotDigest) ||
        (target && !isDeepStrictEqual(parsedTarget, target)) ||
        (value.phase === "completed" &&
            (value.status !== "succeeded" || value.recoveryRequired || value.restorationReady)) ||
        (value.phase === "rolled-back" &&
            (value.status !== "failed" || value.recoveryRequired || value.restorationReady)) ||
        (value.status === "succeeded" && value.phase !== "completed") ||
        (value.restorationReady === true &&
            !["restoration-ready", "manager-installing", "manager-ready"].includes(value.phase))
    )
        throw failure();
    return structuredClone(value) as unknown as WindowsServiceMigrationRecord;
}
export function saveWindowsMigrationRecord(
    storage: ServiceOperationStorage,
    record: WindowsServiceMigrationRecord,
    stateDirectory: string,
    host: ServiceHost,
    createOnly = false,
): WindowsServiceMigrationRecord {
    storage.write(WINDOWS_MIGRATION_ACTIVE, record, createOnly);
    secureWindowsServiceFile(
        host,
        path.join(windowsMigrationStateDirectory(stateDirectory), WINDOWS_MIGRATION_ACTIVE),
    );
    return readWindowsMigrationRecord(storage, stateDirectory, host);
}
export function readWindowsMigrationRecord(
    storage: ServiceOperationStorage,
    stateDirectory: string,
    host: ServiceHost,
    target?: ManagerServiceSpec,
): WindowsServiceMigrationRecord {
    inspectWindowsServiceFileSecurity(
        host,
        path.join(windowsMigrationStateDirectory(stateDirectory), WINDOWS_MIGRATION_ACTIVE),
    );
    return parseWindowsMigrationRecord(storage.read(WINDOWS_MIGRATION_ACTIVE), target);
}
export function windowsMigrationStateDirectory(stateDirectory: string): string {
    return path.join(windowsMigrationRootDirectory(stateDirectory), "state");
}
function windowsMigrationRootDirectory(stateDirectory: string): string {
    return path.join(stateDirectory, "windows-migration");
}
export function publicWindowsMigrationResult(
    record: WindowsServiceMigrationRecord,
): WindowsServiceMigrationResult {
    const { id, phase, status, recoveryRequired, restorationReady } = record;
    return {
        id,
        phase,
        status,
        recoveryRequired,
        restorationReady,
        rolledBack: phase === "rolled-back",
    };
}
