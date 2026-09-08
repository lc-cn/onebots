import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";
const folders: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "migration-journal-"));
    folders.push(directory);
    const raw = Buffer.from([0, 255, 13, 10, 65]);
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: "/tmp/workspace",
            nodePath: "/tmp/node",
            binPath: "/tmp/bin.js",
            workingDirectory: "/tmp",
            host: "127.0.0.1",
            port: 6727,
        },
        previousRunning: true,
        previousEnabled: false,
        files: ["definition", "metadata", "configuration"].map(role => ({
            role: role as ServiceMigrationBackup["files"][number]["role"],
            path: `/tmp/${role}`,
            mode: 0o600,
            contentBase64: raw.toString("base64"),
        })),
    };
    return { directory, raw, backup, journal: new FileServiceMigrationJournal(directory) };
}
describe("service migration private journal", () => {
    it("preserves exact bytes with closed snapshots and private modes", () => {
        const test = fixture();
        const record = test.journal.prepare("first", test.backup);
        test.backup.files[0].contentBase64 = "";
        expect(Buffer.from(test.journal.backup(record).files[0].contentBase64, "base64")).toEqual(
            test.raw,
        );
        expect(fs.statSync(test.directory).mode & 0o777).toBe(0o700);
        expect(
            fs.statSync(path.join(test.directory, `${record.backupDigest}.backup.json`)).mode &
                0o777,
        ).toBe(0o400);
        expect(fs.statSync(path.join(test.directory, "first.journal.json")).mode & 0o777).toBe(
            0o600,
        );
        expect(() => test.journal.prepare("first", test.backup)).toThrow();
        expect(() => test.journal.prepare("second", test.backup)).toThrow();
    });
    it("cold running becomes interrupted without replay; successful reconciliation permits a fresh id", () => {
        const test = fixture();
        test.journal.prepare("first", test.backup);
        const cold = new FileServiceMigrationJournal(test.directory);
        const record = cold.read("first");
        expect(record).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(() => cold.prepare("second", test.backup)).toThrow();
        cold.save({
            ...record,
            status: "failed",
            phase: "completed",
            rolledBack: true,
            recoveryRequired: false,
        });
        expect(() => cold.prepare("first", test.backup)).toThrow();
        expect(cold.prepare("second", test.backup).status).toBe("running");
    });
    it("rejects noncanonical base64, duplicate roles, unsafe modes, relative paths and unknown fields", () => {
        const test = fixture();
        for (const change of [
            { contentBase64: "YQ" },
            { mode: 0o1000 },
            { path: "relative" },
            { role: "metadata" },
            { contentBase64: "YQ==\n" },
            { extra: true },
        ]) {
            const backup = structuredClone(test.backup);
            Object.assign(backup.files[0], change);
            expect(() => test.journal.prepare("invalid", backup)).toThrow();
        }
        const backup = Object.defineProperty({}, "schemaVersion", {
            enumerable: true,
            get: () => {
                throw new Error("synthetic-secret");
            },
        });
        expect(() => test.journal.prepare("invalid", backup as ServiceMigrationBackup)).toThrow(
            "服务迁移私有记录无效",
        );
    });
    it("rejects backup permissions, byte tampering and symlinks; corrupt logs block new ids", () => {
        const test = fixture();
        const record = test.journal.prepare("first", test.backup);
        const file = path.join(test.directory, `${record.backupDigest}.backup.json`);
        fs.chmodSync(file, 0o600);
        expect(() => test.journal.read("first")).toThrow();
        fs.writeFileSync(file, "{}");
        fs.chmodSync(file, 0o400);
        expect(() => test.journal.read("first")).toThrow();
        const cold = new FileServiceMigrationJournal(test.directory);
        expect(() => cold.prepare("second", test.backup)).toThrow();
        fs.unlinkSync(file);
        fs.symlinkSync("/tmp/nonexistent", file);
        expect(() => cold.backup(record)).toThrow();
    });
    it("backup persistence failure cannot publish a prepared journal", () => {
        const test = fixture();
        const original = fs.renameSync;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (String(to).endsWith(".backup.json")) throw new Error("synthetic-secret");
            original(from, to);
        });
        expect(() => test.journal.prepare("first", test.backup)).toThrow("服务迁移私有记录无效");
        expect(fs.readdirSync(test.directory)).toEqual([]);
    });
    it("save cannot create a new operation or exchange its backup", () => {
        const test = fixture();
        const record = test.journal.prepare("first", test.backup);
        expect(() => test.journal.save({ ...record, id: "second" })).toThrow();
        expect(() => test.journal.save({ ...record, backupDigest: "f".repeat(64) })).toThrow();
        expect(() => test.journal.save({ ...record, status: "succeeded" })).toThrow();
    });
});

it("completed operations cannot revive, but uncertain final persistence may strengthen the recovery gate", () => {
    const test = fixture();
    const record = test.journal.prepare("first", test.backup);
    const completed = { ...record, phase: "completed" as const, status: "succeeded" as const };
    test.journal.save(completed);
    expect(() => test.journal.save(record)).toThrow();
    test.journal.save({ ...completed, status: "interrupted", recoveryRequired: true });
    expect(() => test.journal.prepare("second", test.backup)).toThrow();
    expect(() => test.journal.save(record)).toThrow();
});

it("dangling journal and backup links are not overwritten as missing files", () => {
    const test = fixture();
    fs.symlinkSync("/tmp/absent-service-journal", path.join(test.directory, "first.journal.json"));
    expect(() => test.journal.prepare("first", test.backup)).toThrow();
    expect(fs.lstatSync(path.join(test.directory, "first.journal.json")).isSymbolicLink()).toBe(
        true,
    );
    fs.unlinkSync(path.join(test.directory, "first.journal.json"));
    const record = test.journal.prepare("first", test.backup);
    const file = path.join(test.directory, `${record.backupDigest}.backup.json`);
    test.journal.save({ ...record, status: "succeeded", phase: "completed" });
    fs.unlinkSync(file);
    fs.symlinkSync("/tmp/absent-service-backup", file);
    expect(() => test.journal.prepare("second", test.backup)).toThrow();
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
});
