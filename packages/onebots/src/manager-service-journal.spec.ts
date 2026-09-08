import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileManagerServiceJournal, type ManagerServiceAction } from "./manager-service-journal.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-operation-")));
    roots.push(root);
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: "/tmp/workspace",
        workingDirectory: "/tmp/working",
        nodePath: "/usr/local/bin/node",
        binPath: "/tmp/bin.js",
        host: "127.0.0.1",
        port: 6727,
    };
    return { root, spec, journal: new FileManagerServiceJournal(root) };
}
describe("ordinary manager service operation journal", () => {
    it.each(["install", "start", "stop", "restart", "uninstall"] as ManagerServiceAction[])(
        "persists %s intent and immutable management spec without runtime config",
        action => {
            const test = fixture();
            const record = test.journal.prepare({
                id: "op-1",
                action,
                desiredEnabled: true,
                spec: test.spec,
            });
            test.spec.host = "0.0.0.0";
            expect(record).toMatchObject({
                status: "running",
                phase: "prepared",
                desiredEnabled: true,
                managerSpec: { host: "127.0.0.1" },
            });
            expect(record.managerSpecDigest).toMatch(/^[0-9a-f]{64}$/);
            expect(Object.keys(record).sort()).toEqual([
                "action",
                "desiredEnabled",
                "id",
                "managerSpec",
                "managerSpecDigest",
                "phase",
                "recoveryRequired",
                "schemaVersion",
                "status",
            ]);
            expect(fs.statSync(path.join(test.root, "op-1.json")).mode & 0o777).toBe(0o600);
            expect(fs.statSync(test.root).mode & 0o777).toBe(0o700);
            expect(() =>
                test.journal.prepare({
                    id: "new-id",
                    action,
                    desiredEnabled: true,
                    spec: test.spec,
                }),
            ).toThrow();
        },
    );
    it("cold startup blocks running operation, including completed phase with unknown persistence", () => {
        const test = fixture();
        const record = test.journal.prepare({
            id: "op-1",
            action: "uninstall",
            desiredEnabled: false,
            spec: test.spec,
        });
        test.journal.save({ ...record, phase: "completed" });
        const cold = new FileManagerServiceJournal(test.root);
        expect(cold.read("op-1")).toMatchObject({
            status: "interrupted",
            phase: "completed",
            recoveryRequired: true,
            managerSpec: test.spec,
        });
        expect(cold.health()).toEqual({ recoveryRequired: true });
        expect(() =>
            cold.prepare({ id: "op-2", action: "install", desiredEnabled: true, spec: test.spec }),
        ).toThrow();
        expect(() => cold.save(record)).toThrow();
    });
    it("successful completion permits fresh operations but no replay or terminal revival", () => {
        const test = fixture();
        const record = test.journal.prepare({
            id: "op-1",
            action: "stop",
            desiredEnabled: true,
            spec: test.spec,
        });
        const terminal = { ...record, status: "succeeded" as const, phase: "completed" as const };
        test.journal.save(terminal);
        expect(test.journal.health().recoveryRequired).toBe(false);
        expect(() => test.journal.save(record)).toThrow();
        expect(() =>
            test.journal.prepare({
                id: "op-1",
                action: "stop",
                desiredEnabled: true,
                spec: test.spec,
            }),
        ).toThrow();
        expect(
            test.journal.prepare({
                id: "op-2",
                action: "start",
                desiredEnabled: true,
                spec: test.spec,
            }).status,
        ).toBe("running");
    });
    it("changing spec/digest/action/enablement or adding secret fields cannot mutate the operation contract", () => {
        const test = fixture();
        const record = test.journal.prepare({
            id: "op-1",
            action: "stop",
            desiredEnabled: true,
            spec: test.spec,
        });
        for (const altered of [
            { ...record, managerSpec: { ...record.managerSpec, port: 7000 } },
            { ...record, managerSpecDigest: "f".repeat(64) },
            { ...record, action: "start" as const },
            { ...record, desiredEnabled: false },
            { ...record, secret: "synthetic-secret" },
        ])
            expect(() => test.journal.save(altered)).toThrow();
        const raw = JSON.parse(fs.readFileSync(path.join(test.root, "op-1.json"), "utf8"));
        raw.managerSpec.port = 7000;
        fs.writeFileSync(path.join(test.root, "op-1.json"), JSON.stringify(raw));
        const cold = new FileManagerServiceJournal(test.root);
        expect(cold.health().recoveryRequired).toBe(true);
        expect(() => cold.read("op-1")).toThrow();
    });
    it("permissions, symlinks, unknown files and malformed journals fail closed without overwriting", () => {
        const test = fixture();
        fs.symlinkSync(path.join(test.root, "missing"), path.join(test.root, "op-1.json"));
        expect(() =>
            test.journal.prepare({
                id: "op-1",
                action: "start",
                desiredEnabled: true,
                spec: test.spec,
            }),
        ).toThrow();
        expect(fs.lstatSync(path.join(test.root, "op-1.json")).isSymbolicLink()).toBe(true);
        fs.unlinkSync(path.join(test.root, "op-1.json"));
        test.journal.prepare({
            id: "op-1",
            action: "start",
            desiredEnabled: true,
            spec: test.spec,
        });
        fs.chmodSync(path.join(test.root, "op-1.json"), 0o644);
        expect(test.journal.health().recoveryRequired).toBe(true);
        fs.chmodSync(path.join(test.root, "op-1.json"), 0o600);
        fs.writeFileSync(path.join(test.root, "op-1.json"), "synthetic-secret");
        expect(() => test.journal.read("op-1")).toThrow("管理服务操作记录未确认");
        fs.writeFileSync(path.join(test.root, ".operation-interrupted.tmp"), "partial");
        expect(new FileManagerServiceJournal(test.root).health().recoveryRequired).toBe(true);
    });
    it("intent publication failure leaves no success, and final fsync uncertainty can strengthen a completed gate", () => {
        const test = fixture();
        vi.spyOn(fs, "linkSync").mockImplementation(() => {
            throw new Error("synthetic-secret");
        });
        expect(() =>
            test.journal.prepare({
                id: "op-1",
                action: "start",
                desiredEnabled: true,
                spec: test.spec,
            }),
        ).toThrow("管理服务操作记录未确认");
        expect(fs.readdirSync(test.root)).toEqual([]);
        vi.restoreAllMocks();
        const record = test.journal.prepare({
            id: "op-1",
            action: "start",
            desiredEnabled: true,
            spec: test.spec,
        });
        test.journal.save({ ...record, phase: "completed", status: "succeeded" });
        test.journal.save({
            ...record,
            phase: "completed",
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(new FileManagerServiceJournal(test.root).health().recoveryRequired).toBe(true);
    });
});
