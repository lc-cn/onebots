import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseServiceMigrationRecord } from "./service-migration-record.js";

const hash = "a".repeat(64);
const base = {
    id: "migration-1",
    backupDigest: hash,
    phase: "prepared",
    status: "running",
    recoveryRequired: false,
    rolledBack: false,
};
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

describe("service migration record schema", () => {
    it("strictly reads legacy v1 without accepting v2 phases or evidence", () => {
        expect(parseServiceMigrationRecord({ schemaVersion: 1, ...base })).toEqual({
            schemaVersion: 1,
            ...base,
        });
        expect(() =>
            parseServiceMigrationRecord({
                schemaVersion: 1,
                ...base,
                phase: "target-written",
            }),
        ).toThrow();
        expect(() =>
            parseServiceMigrationRecord({
                schemaVersion: 1,
                ...base,
                rollbackOrigin: "pre-target",
            }),
        ).toThrow();
    });

    it("reads exact v2 rollback evidence and rejects partial start evidence", () => {
        const reloadOldReceipt = {
            schemaVersion: 1 as const,
            backupDigest: hash,
            rollbackContractDigest: "b".repeat(64),
            enabled: true,
            loaded: true,
            definitionPath: "/etc/systemd/system/onebots.service",
        };
        const startOldReceipt = {
            schemaVersion: 1 as const,
            reloadReceiptDigest: createHash("sha256")
                .update(canonical(reloadOldReceipt))
                .digest("hex"),
            processId: 42,
            identity: "0123456789abcdef0123456789abcdef",
        };
        expect(
            parseServiceMigrationRecord({
                schemaVersion: 2,
                ...base,
                phase: "verifying-restored",
                rollbackOrigin: "target-written",
                reloadOldReceipt,
                startOldReceipt,
            }),
        ).toMatchObject({ rollbackOrigin: "target-written", reloadOldReceipt, startOldReceipt });
        expect(() =>
            parseServiceMigrationRecord({
                schemaVersion: 2,
                ...base,
                phase: "starting-old",
                rollbackOrigin: "pre-target",
                startOldReceipt,
            }),
        ).toThrow();
    });

    it("keeps v2 rollback phases closed until their required evidence exists", () => {
        const reloadOldReceipt = {
            schemaVersion: 1 as const,
            backupDigest: hash,
            rollbackContractDigest: "b".repeat(64),
            enabled: true,
            loaded: true,
            definitionPath: "/tmp/onebots.service",
        };
        for (const phase of ["restoring", "reloading-old", "restarting-old"] as const)
            expect(() =>
                parseServiceMigrationRecord({ schemaVersion: 2, ...base, phase }),
            ).toThrow();
        expect(
            parseServiceMigrationRecord({
                schemaVersion: 2,
                ...base,
                phase: "reloading-old",
                rollbackOrigin: "pre-target",
            }),
        ).toMatchObject({ phase: "reloading-old", rollbackOrigin: "pre-target" });
        for (const phase of ["starting-old", "verifying-restored"] as const)
            expect(() =>
                parseServiceMigrationRecord({
                    schemaVersion: 2,
                    ...base,
                    phase,
                    rollbackOrigin: "pre-target",
                }),
            ).toThrow();
        expect(
            parseServiceMigrationRecord({
                schemaVersion: 2,
                ...base,
                phase: "starting-old",
                rollbackOrigin: "pre-target",
                reloadOldReceipt,
            }),
        ).toMatchObject({ phase: "starting-old", reloadOldReceipt });
    });

    it("requires completed rollback evidence while leaving running-instance policy to journal", () => {
        const completed = {
            schemaVersion: 2,
            ...base,
            phase: "completed",
            status: "failed",
            recoveryRequired: false,
            rolledBack: true,
            rollbackOrigin: "target-written",
        };
        expect(() => parseServiceMigrationRecord(completed)).toThrow();
        expect(
            parseServiceMigrationRecord({
                ...completed,
                reloadOldReceipt: {
                    schemaVersion: 1,
                    backupDigest: hash,
                    rollbackContractDigest: "b".repeat(64),
                    enabled: false,
                    loaded: true,
                    definitionPath: "/tmp/onebots.service",
                },
            }),
        ).toMatchObject({ phase: "completed", rolledBack: true });
    });

    it("rejects nonterminal status and rollback evidence on successful terminal records", () => {
        for (const status of ["running", "interrupted"] as const)
            expect(() =>
                parseServiceMigrationRecord({
                    schemaVersion: 2,
                    ...base,
                    phase: "completed",
                    status,
                    recoveryRequired: status === "interrupted",
                }),
            ).toThrow();
        expect(() =>
            parseServiceMigrationRecord({
                schemaVersion: 2,
                ...base,
                phase: "completed",
                status: "succeeded",
                rollbackOrigin: "target-written",
            }),
        ).toThrow();
        expect(() =>
            parseServiceMigrationRecord({
                schemaVersion: 2,
                ...base,
                phase: "completed",
                status: "interrupted",
                recoveryRequired: true,
                rollbackOrigin: "target-written",
                reloadOldReceipt: {
                    schemaVersion: 1,
                    backupDigest: hash,
                    rollbackContractDigest: "b".repeat(64),
                    enabled: true,
                    loaded: true,
                    definitionPath: "/tmp/onebots.service",
                },
            }),
        ).toThrow();
    });

    it("rejects malformed or open receipt objects", () => {
        const record = {
            schemaVersion: 2,
            ...base,
            phase: "reloading-old",
            rollbackOrigin: "pre-target",
            reloadOldReceipt: {
                schemaVersion: 1,
                backupDigest: hash,
                rollbackContractDigest: "b".repeat(64),
                enabled: true,
                loaded: false,
                definitionPath: "/tmp/onebots.service",
                extra: true,
            },
        };
        expect(() => parseServiceMigrationRecord(record)).toThrow();
        delete (record.reloadOldReceipt as Record<string, unknown>).extra;
        record.reloadOldReceipt.definitionPath = "relative";
        expect(() => parseServiceMigrationRecord(record)).toThrow();
        expect(() =>
            parseServiceMigrationRecord({
                schemaVersion: 2,
                ...base,
                rollbackOrigin: "pre-target",
            }),
        ).toThrow();
    });
});
