import { createHash } from "node:crypto";
import { closedServiceObject } from "./service-operation-storage.js";
import type {
    ServiceMigrationRecord,
    ServiceMigrationReloadOldReceipt,
    ServiceMigrationStartOldReceipt,
} from "./service-migration-types.js";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const invalid = () => new Error("服务迁移私有记录无效");
const legacyPhases = [
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
const v2Phases = [
    ...legacyPhases.filter(phase => phase !== "restarting-old"),
    "target-written",
    "reloading-old",
    "starting-old",
    "verifying-restored",
];
export function parseServiceMigrationRecord(input: unknown): ServiceMigrationRecord {
    const schemaVersion =
        input && typeof input === "object"
            ? Object.getOwnPropertyDescriptor(input, "schemaVersion")?.value
            : undefined;
    const v2 = schemaVersion === 2;
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
        ...(v2 && Object.hasOwn(input as object, "rollbackOrigin") ? ["rollbackOrigin"] : []),
        ...(v2 && Object.hasOwn(input as object, "reloadOldReceipt") ? ["reloadOldReceipt"] : []),
        ...(v2 && Object.hasOwn(input as object, "startOldReceipt") ? ["startOldReceipt"] : []),
    ]);
    if (
        (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
        typeof value.id !== "string" ||
        !ID.test(value.id) ||
        typeof value.backupDigest !== "string" ||
        !HASH.test(value.backupDigest) ||
        typeof value.phase !== "string" ||
        !(v2 ? v2Phases : legacyPhases).includes(value.phase) ||
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
    if (
        Object.hasOwn(value, "rollbackOrigin") &&
        !["pre-target", "target-written"].includes(String(value.rollbackOrigin))
    )
        throw invalid();
    if (Object.hasOwn(value, "rollbackOrigin")) {
        const rollbackPhases =
            value.rollbackOrigin === "pre-target"
                ? [
                      "stopping-old",
                      "restoring",
                      "reloading-old",
                      "starting-old",
                      "verifying-restored",
                      "completed",
                  ]
                : [
                      "target-written",
                      "stopping-target",
                      "restoring",
                      "reloading-old",
                      "starting-old",
                      "verifying-restored",
                      "completed",
                  ];
        if (!rollbackPhases.includes(String(value.phase))) throw invalid();
    }
    if (Object.hasOwn(value, "reloadOldReceipt"))
        value.reloadOldReceipt = parseReloadOldReceipt(value.reloadOldReceipt);
    if (Object.hasOwn(value, "startOldReceipt"))
        value.startOldReceipt = parseStartOldReceipt(value.startOldReceipt);
    if (Object.hasOwn(value, "startOldReceipt") && !Object.hasOwn(value, "reloadOldReceipt"))
        throw invalid();
    if (
        Object.hasOwn(value, "reloadOldReceipt") &&
        (!Object.hasOwn(value, "rollbackOrigin") ||
            (value.reloadOldReceipt as ServiceMigrationReloadOldReceipt).backupDigest !==
                value.backupDigest ||
            !["reloading-old", "starting-old", "verifying-restored", "completed"].includes(
                String(value.phase),
            ))
    )
        throw invalid();
    if (
        Object.hasOwn(value, "startOldReceipt") &&
        ((value.startOldReceipt as ServiceMigrationStartOldReceipt).reloadReceiptDigest !==
            createHash("sha256").update(canonical(value.reloadOldReceipt)).digest("hex") ||
            !["starting-old", "verifying-restored", "completed"].includes(String(value.phase)))
    )
        throw invalid();
    if (
        value.schemaVersion === 2 &&
        (["restoring", "reloading-old"].includes(String(value.phase))
            ? !Object.hasOwn(value, "rollbackOrigin")
            : ["starting-old", "verifying-restored"].includes(String(value.phase))
              ? !Object.hasOwn(value, "rollbackOrigin") || !Object.hasOwn(value, "reloadOldReceipt")
              : value.phase === "completed" && value.status === "failed" && value.rolledBack
                ? !Object.hasOwn(value, "rollbackOrigin") ||
                  !Object.hasOwn(value, "reloadOldReceipt")
                : false)
    )
        throw invalid();
    if (
        value.schemaVersion === 2 &&
        value.phase === "completed" &&
        (!["succeeded", "failed"].includes(String(value.status)) ||
            (value.status === "succeeded" &&
                (Object.hasOwn(value, "rollbackOrigin") ||
                    Object.hasOwn(value, "reloadOldReceipt") ||
                    Object.hasOwn(value, "startOldReceipt"))) ||
            (Object.hasOwn(value, "rollbackOrigin") && !Object.hasOwn(value, "reloadOldReceipt")))
    )
        throw invalid();
    if (
        value.schemaVersion === 2 &&
        ((value.status === "running" && (value.recoveryRequired || value.rolledBack)) ||
            (value.status === "interrupted" && (!value.recoveryRequired || value.rolledBack)) ||
            (value.status === "failed" &&
                !(
                    (value.phase === "cancelled" && !value.recoveryRequired && !value.rolledBack) ||
                    (value.phase === "completed" && !value.recoveryRequired && value.rolledBack)
                )))
    )
        throw invalid();
    return value as unknown as ServiceMigrationRecord;
}

export function parseServiceMigrationReloadOldReceipt(
    input: unknown,
): ServiceMigrationReloadOldReceipt {
    return parseReloadOldReceipt(input);
}

export function parseServiceMigrationStartOldReceipt(
    input: unknown,
): ServiceMigrationStartOldReceipt {
    return parseStartOldReceipt(input);
}

function parseReloadOldReceipt(input: unknown): ServiceMigrationReloadOldReceipt {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "backupDigest",
        "rollbackContractDigest",
        "enabled",
        "loaded",
        "definitionPath",
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.backupDigest !== "string" ||
        !HASH.test(value.backupDigest) ||
        typeof value.rollbackContractDigest !== "string" ||
        !HASH.test(value.rollbackContractDigest) ||
        typeof value.enabled !== "boolean" ||
        typeof value.loaded !== "boolean" ||
        typeof value.definitionPath !== "string" ||
        !value.definitionPath.startsWith("/") ||
        value.definitionPath.length > 4096 ||
        /[\u0000\r\n]/.test(value.definitionPath)
    )
        throw invalid();
    return value as unknown as ServiceMigrationReloadOldReceipt;
}

function parseStartOldReceipt(input: unknown): ServiceMigrationStartOldReceipt {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "reloadReceiptDigest",
        "processId",
        "identity",
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.reloadReceiptDigest !== "string" ||
        !HASH.test(value.reloadReceiptDigest) ||
        !Number.isSafeInteger(value.processId) ||
        Number(value.processId) < 1 ||
        Number(value.processId) > 0x7fffffff ||
        typeof value.identity !== "string" ||
        value.identity.length < 1 ||
        value.identity.length > 512 ||
        /[\u0000\r\n]/.test(value.identity)
    )
        throw invalid();
    return value as unknown as ServiceMigrationStartOldReceipt;
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
