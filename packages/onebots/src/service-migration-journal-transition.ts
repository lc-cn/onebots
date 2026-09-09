import { createHash } from "node:crypto";
import {
    parseServiceMigrationRecord,
    parseServiceMigrationReloadOldReceipt,
    parseServiceMigrationStartOldReceipt,
} from "./service-migration-record.js";
import type {
    ServiceMigrationBackup,
    ServiceMigrationJournalTransition,
    ServiceMigrationRecord,
} from "./service-migration-types.js";

const invalid = () => new Error("服务迁移状态转换无效");

export function deriveServiceMigrationTransition(
    previous: ServiceMigrationRecord,
    backup: ServiceMigrationBackup,
    input: ServiceMigrationJournalTransition,
): ServiceMigrationRecord {
    const command = closedTransition(input);
    const base: ServiceMigrationRecord = {
        ...previous,
        ...(previous.previousBackupDigests
            ? { previousBackupDigests: [...previous.previousBackupDigests] }
            : {}),
        ...(previous.reloadOldReceipt
            ? { reloadOldReceipt: parseServiceMigrationReloadOldReceipt(previous.reloadOldReceipt) }
            : {}),
        ...(previous.startOldReceipt
            ? { startOldReceipt: parseServiceMigrationStartOldReceipt(previous.startOldReceipt) }
            : {}),
    };
    const active =
        previous.status === "running" && !previous.recoveryRequired && !previous.rolledBack;
    const recovering =
        previous.status === "interrupted" && previous.recoveryRequired && !previous.rolledBack;
    const rollback = active || recovering;
    let next: ServiceMigrationRecord;
    switch (command.type) {
        case "interrupt":
            if (!active || ["cancelled", "completed"].includes(previous.phase)) throw invalid();
            next = { ...base, status: "interrupted", recoveryRequired: true };
            break;
        case "target-written":
            if (!active || previous.schemaVersion !== 1 || previous.phase !== "writing-target")
                throw invalid();
            next = { ...base, schemaVersion: 2, phase: "target-written" };
            break;
        case "advance-target": {
            if (!active || previous.schemaVersion !== 2 || previous.rollbackOrigin) throw invalid();
            const phases: Partial<Record<typeof previous.phase, typeof previous.phase>> = {
                "target-written": backup.previousRunning ? "starting-manager" : "verifying",
                "starting-manager": "verifying",
                verifying: "releasing-target",
            };
            const phase = phases[previous.phase];
            if (!phase) throw invalid();
            next = { ...base, phase };
            break;
        }
        case "complete-success":
            if (
                !active ||
                previous.schemaVersion !== 2 ||
                previous.phase !== "releasing-target" ||
                previous.rollbackOrigin ||
                previous.reloadOldReceipt ||
                previous.startOldReceipt
            )
                throw invalid();
            next = { ...base, phase: "completed", status: "succeeded" };
            break;
        case "begin-rollback":
            if (!rollback) throw invalid();
            if (command.origin === "pre-target") {
                if (previous.schemaVersion !== 1 || previous.phase !== "stopping-old")
                    throw invalid();
                next = {
                    ...base,
                    schemaVersion: 2,
                    phase: "restoring",
                    rollbackOrigin: "pre-target",
                };
            } else {
                if (
                    !(
                        (previous.schemaVersion === 1 && previous.phase === "writing-target") ||
                        (previous.schemaVersion === 2 &&
                            ["target-written", "starting-manager", "verifying"].includes(
                                previous.phase,
                            ) &&
                            !previous.rollbackOrigin)
                    )
                )
                    throw invalid();
                next = {
                    ...base,
                    schemaVersion: 2,
                    phase: "stopping-target",
                    rollbackOrigin: "target-written",
                };
            }
            break;
        case "restoring":
            if (
                !rollback ||
                previous.schemaVersion !== 2 ||
                previous.phase !== "stopping-target" ||
                previous.rollbackOrigin !== "target-written"
            )
                throw invalid();
            next = { ...base, phase: "restoring" };
            break;
        case "reloading-old":
            if (
                !rollback ||
                previous.schemaVersion !== 2 ||
                previous.phase !== "restoring" ||
                !previous.rollbackOrigin
            )
                throw invalid();
            next = { ...base, phase: "reloading-old" };
            break;
        default:
            throw invalid();
    }
    return parseServiceMigrationRecord(next);
}

function closedTransition(input: unknown): ServiceMigrationJournalTransition {
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
        throw invalid();
    const type = Object.getOwnPropertyDescriptor(input, "type");
    if (!type?.enumerable || !("value" in type) || typeof type.value !== "string") throw invalid();
    const fields = ["type", ...(type.value === "begin-rollback" ? ["origin"] : [])];
    const keys = Reflect.ownKeys(input);
    if (
        keys.length !== fields.length ||
        keys.some(key => typeof key !== "string" || !fields.includes(key))
    )
        throw invalid();
    const output: Record<string, unknown> = { type: type.value };
    for (const field of fields) {
        const descriptor = field === "type" ? type : Object.getOwnPropertyDescriptor(input, field);
        if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
        output[field] = descriptor.value;
    }
    if (
        type.value === "begin-rollback" &&
        !["pre-target", "target-written"].includes(String(output.origin))
    )
        throw invalid();
    return output as ServiceMigrationJournalTransition;
}

export function deriveServiceMigrationReloaded(
    previous: ServiceMigrationRecord,
    backup: ServiceMigrationBackup,
    input: unknown,
): ServiceMigrationRecord {
    const receipt = parseServiceMigrationReloadOldReceipt(input);
    if (
        !recovering(previous) ||
        previous.phase !== "reloading-old" ||
        !previous.rollbackOrigin ||
        previous.reloadOldReceipt ||
        receipt.backupDigest !== previous.backupDigest ||
        receipt.enabled !== backup.previousEnabled
    )
        throw invalid();
    return parseServiceMigrationRecord({
        ...snapshot(previous),
        phase: backup.previousRunning ? "starting-old" : "verifying-restored",
        reloadOldReceipt: receipt,
    });
}

export function deriveServiceMigrationStarted(
    previous: ServiceMigrationRecord,
    backup: ServiceMigrationBackup,
    input: unknown,
): ServiceMigrationRecord {
    const receipt = parseServiceMigrationStartOldReceipt(input);
    if (
        !recovering(previous) ||
        !backup.previousRunning ||
        previous.phase !== "starting-old" ||
        !previous.rollbackOrigin ||
        !previous.reloadOldReceipt ||
        previous.startOldReceipt ||
        receipt.reloadReceiptDigest !== digest(previous.reloadOldReceipt)
    )
        throw invalid();
    return parseServiceMigrationRecord({
        ...snapshot(previous),
        phase: "verifying-restored",
        startOldReceipt: receipt,
    });
}

export function deriveServiceMigrationRollbackCompleted(
    previous: ServiceMigrationRecord,
    backup: ServiceMigrationBackup,
): ServiceMigrationRecord {
    if (
        !recovering(previous) ||
        previous.phase !== "verifying-restored" ||
        !previous.rollbackOrigin ||
        !previous.reloadOldReceipt ||
        Boolean(previous.startOldReceipt) !== backup.previousRunning
    )
        throw invalid();
    return parseServiceMigrationRecord({
        ...snapshot(previous),
        phase: "completed",
        status: "failed",
        recoveryRequired: false,
        rolledBack: true,
    });
}

function recovering(record: ServiceMigrationRecord): boolean {
    return (
        record.schemaVersion === 2 &&
        ((record.status === "running" && !record.recoveryRequired) ||
            (record.status === "interrupted" && record.recoveryRequired)) &&
        !record.rolledBack
    );
}

function snapshot(previous: ServiceMigrationRecord): ServiceMigrationRecord {
    return {
        ...previous,
        ...(previous.previousBackupDigests
            ? { previousBackupDigests: [...previous.previousBackupDigests] }
            : {}),
        ...(previous.reloadOldReceipt
            ? { reloadOldReceipt: parseServiceMigrationReloadOldReceipt(previous.reloadOldReceipt) }
            : {}),
        ...(previous.startOldReceipt
            ? { startOldReceipt: parseServiceMigrationStartOldReceipt(previous.startOldReceipt) }
            : {}),
    };
}

function digest(value: unknown): string {
    return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
            )
            .join(",")}}`;
    return JSON.stringify(value);
}
