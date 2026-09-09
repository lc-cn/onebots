import { closedServiceObject } from "./service-operation-storage.js";
import type { ServiceMigrationRecord } from "./service-migration-types.js";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const invalid = () => new Error("服务迁移私有记录无效");
const phases = [
    "prepared",
    "capturing-runtime",
    "preparing-manager",
    "stopping-old",
    "writing-target",
    "starting-manager",
    "verifying",
    "releasing-target",
    "stopping-target",
    "restoring",
    "restarting-old",
    "cancelled",
    "completed",
];
export function parseServiceMigrationRecord(input: unknown): ServiceMigrationRecord {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "id",
        "backupDigest",
        "phase",
        "status",
        "recoveryRequired",
        "rolledBack",
        ...(input && typeof input === "object" && Object.hasOwn(input, "previousBackupDigests")
            ? ["previousBackupDigests"]
            : []),
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.id !== "string" ||
        !ID.test(value.id) ||
        typeof value.backupDigest !== "string" ||
        !HASH.test(value.backupDigest) ||
        typeof value.phase !== "string" ||
        !phases.includes(value.phase) ||
        typeof value.status !== "string" ||
        !["running", "succeeded", "failed", "interrupted"].includes(value.status) ||
        typeof value.recoveryRequired !== "boolean" ||
        typeof value.rolledBack !== "boolean"
    )
        throw invalid();
    if (Object.hasOwn(value, "previousBackupDigests")) {
        const history = value.previousBackupDigests;
        if (
            !Array.isArray(history) ||
            history.length > 8 ||
            !history.length ||
            Reflect.ownKeys(history).length !== history.length + 1
        )
            throw invalid();
        const hashes = Array.from({ length: history.length }, (_, index) => {
            const field = Object.getOwnPropertyDescriptor(history, String(index));
            if (
                !field?.enumerable ||
                !("value" in field) ||
                typeof field.value !== "string" ||
                !HASH.test(field.value) ||
                field.value === value.backupDigest
            )
                throw invalid();
            return field.value as string;
        });
        if (new Set(hashes).size !== hashes.length) throw invalid();
    }
    if (
        value.status === "succeeded" &&
        (value.phase !== "completed" || value.recoveryRequired || value.rolledBack)
    )
        throw invalid();
    if (value.status === "interrupted" && !value.recoveryRequired) throw invalid();
    if (
        value.phase === "cancelled" &&
        (value.status !== "failed" || value.recoveryRequired || value.rolledBack)
    )
        throw invalid();
    return value as unknown as ServiceMigrationRecord;
}
