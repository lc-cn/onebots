import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlOperationObserver, readControlLog } from "./control/gateway-log.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "service-observer-")));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, ".control"), { recursive: true, mode: 0o700 });
    const secret = "private-token-and-path";
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        workingDirectory: path.join(root, secret),
        nodePath: path.join(root, secret, "node"),
        binPath: path.join(root, secret, "bin.js"),
        host: "127.0.0.1",
        port: 6727,
    };
    return { root, workspace, secret, spec, observer: createControlOperationObserver(workspace) };
}

function lines(workspace: string): Record<string, unknown>[] {
    return readControlLog(workspace, "operation")
        .text.trim()
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, unknown>);
}

function migrationBackup(test: ReturnType<typeof fixture>): ServiceMigrationBackup {
    return {
        schemaVersion: 1,
        target: test.spec,
        previousRunning: true,
        previousEnabled: true,
        files: ["definition", "metadata", "configuration"].map(role => ({
            role: role as "definition" | "metadata" | "configuration",
            path: path.join(test.root, `${test.secret}-${role}`),
            mode: 0o600,
            contentBase64: Buffer.from(test.secret).toString("base64"),
        })),
    };
}

describe("system service journal operation projection", () => {
    it("projects manager lifecycle only after persistence and excludes the private contract", () => {
        const test = fixture();
        let journal!: FileManagerServiceJournal;
        const observer = vi.fn((operation: Parameters<typeof test.observer>[0]) => {
            expect(journal.read(operation.id)).toMatchObject({
                phase: operation.phase,
                status: operation.status,
            });
            test.observer(operation);
        });
        journal = new FileManagerServiceJournal(path.join(test.root, "manager"), observer);
        const prepared = journal.prepare({
            id: "manager-operation",
            action: "restart",
            desiredEnabled: true,
            spec: test.spec,
        });
        journal.save({ ...prepared, phase: "completed", status: "succeeded" });

        expect(lines(test.workspace).map(({ time: _time, ...operation }) => operation)).toEqual([
            {
                id: "manager-operation",
                action: "manager-service.restart",
                status: "running",
                phase: "prepared",
            },
            {
                id: "manager-operation",
                action: "manager-service.restart",
                status: "succeeded",
                phase: "completed",
            },
        ]);
        expect(JSON.stringify(lines(test.workspace))).not.toContain(test.secret);
        expect(Object.keys(observer.mock.calls[0][0]).sort()).toEqual([
            "action",
            "id",
            "phase",
            "status",
        ]);
    });

    it("projects legacy migration without backup, digest, paths or content", () => {
        const test = fixture();
        const journal = new FileServiceMigrationJournal(
            path.join(test.root, "migration"),
            test.observer,
        );
        const backup = migrationBackup(test);
        const prepared = journal.prepare("migration-operation", backup);
        journal.save({ ...prepared, phase: "completed", status: "succeeded" });

        expect(lines(test.workspace).map(({ time: _time, ...operation }) => operation)).toEqual([
            {
                id: "migration-operation",
                action: "manager-service.migrate",
                status: "running",
                phase: "prepared",
            },
            {
                id: "migration-operation",
                action: "manager-service.migrate",
                status: "succeeded",
                phase: "completed",
            },
        ]);
        const serialized = JSON.stringify(lines(test.workspace));
        expect(serialized).not.toContain(test.secret);
        expect(serialized).not.toContain(prepared.backupDigest);
        expect(serialized).not.toContain(backup.files[0].contentBase64);
    });

    it("observer failure cannot change either persisted journal fact", () => {
        const test = fixture();
        const failed = () => {
            throw new Error(test.secret);
        };
        const manager = new FileManagerServiceJournal(path.join(test.root, "manager"), failed);
        expect(
            manager.prepare({
                id: "manager-failure",
                action: "stop",
                desiredEnabled: true,
                spec: test.spec,
            }),
        ).toMatchObject({ status: "running", phase: "prepared" });

        const migration = new FileServiceMigrationJournal(
            path.join(test.root, "migration"),
            failed,
        );
        const record = migration.prepare("migration-failure", migrationBackup(test));
        expect(migration.read(record.id)).toEqual(record);
    });

    it("cold reads of terminal journals do not emit duplicate projections", () => {
        const test = fixture();
        const observer = vi.fn(test.observer);
        const managerRoot = path.join(test.root, "manager");
        const manager = new FileManagerServiceJournal(managerRoot, observer);
        const managerRecord = manager.prepare({
            id: "terminal-manager",
            action: "start",
            desiredEnabled: false,
            spec: test.spec,
        });
        manager.save({ ...managerRecord, status: "succeeded", phase: "completed" });
        const migrationRoot = path.join(test.root, "migration");
        const migration = new FileServiceMigrationJournal(migrationRoot, observer);
        const migrationRecord = migration.prepare("terminal-migration", migrationBackup(test));
        migration.save({ ...migrationRecord, status: "succeeded", phase: "completed" });
        const count = observer.mock.calls.length;

        expect(new FileManagerServiceJournal(managerRoot, observer).read(managerRecord.id)).toEqual({
            ...managerRecord,
            status: "succeeded",
            phase: "completed",
        });
        expect(
            new FileServiceMigrationJournal(migrationRoot, observer).read(migrationRecord.id),
        ).toEqual({ ...migrationRecord, status: "succeeded", phase: "completed" });
        expect(observer).toHaveBeenCalledTimes(count);
    });
});
