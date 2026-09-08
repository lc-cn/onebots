import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileManagerServiceJournal, parseManagerServiceRecord } from "./manager-service-journal.js";
import { parseManagerServiceUpgrade } from "./manager-service-upgrade-record.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(enabled = true) {
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: "/tmp/workspace",
        workingDirectory: "/tmp/candidate",
        nodePath: "/usr/local/bin/node",
        binPath: "/tmp/candidate/bin.js",
        host: "127.0.0.1",
        port: 6727,
    };
    const file = {
        sha256: "a".repeat(64),
        dev: "1",
        ino: "2",
        uid: 501,
        mode: 0o644,
        size: 32,
        ctimeNs: "10",
        mtimeNs: "10",
    };
    const upgrade = {
        previousSpec: { ...spec, binPath: "/tmp/old/bin.js", workingDirectory: "/tmp/old" },
        previousCandidateDigest: "a".repeat(64),
        candidateDigest: "b".repeat(64),
        snapshot: {
            platform: "linux" as const,
            files: {
                definition: { ...file, path: "/tmp/onebots.service" },
                metadata: { ...file, path: "/tmp/service.json", mode: 0o600, ino: "3" },
            },
            initial: { enabled, processId: null, identity: null },
        },
    };
    return { spec, upgrade };
}
function journal() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manager-upgrade-record-")));
    roots.push(root);
    return { root, journal: new FileManagerServiceJournal(root) };
}
describe("manager upgrade durable identity", () => {
    it.each([true, false])("preserves initial enablement %s through cold recovery", enabled => {
        const test = journal();
        const input = fixture(enabled);
        const record = test.journal.prepare({
            id: "upgrade",
            action: "upgrade",
            desiredEnabled: enabled,
            ...input,
        });
        input.upgrade.previousSpec.binPath = "/tmp/changed.js";
        expect(record.upgrade?.previousSpec.binPath).toBe("/tmp/old/bin.js");
        for (const phase of [
            "stopping",
            "writing",
            "restoring-enablement",
            "verifying",
            "releasing",
        ] as const)
            test.journal.save({ ...record, phase });
        const cold = new FileManagerServiceJournal(test.root);
        expect(cold.recoverable(record.id)).toMatchObject({
            action: "upgrade",
            phase: "releasing",
            status: "interrupted",
            recoveryRequired: true,
            upgrade: fixture(enabled).upgrade,
        });
        expect(cold.health().recoveryRequired).toBe(true);
        expect(() => cold.save({ ...record, action: "stop", upgrade: undefined })).toThrow();
        expect(() =>
            cold.prepare({
                id: "other",
                action: "stop",
                desiredEnabled: enabled,
                spec: input.spec,
            }),
        ).toThrow();
    });
    it.each([true, false])("enforces forward transitions with running=%s", running => {
        const test = journal();
        const { spec, upgrade } = fixture();
        const record = test.journal.prepare({
            id: "upgrade",
            action: "upgrade",
            desiredEnabled: true,
            spec,
            upgrade: {
                ...upgrade,
                snapshot: {
                    ...upgrade.snapshot,
                    initial: {
                        enabled: true,
                        processId: running ? 123 : null,
                        identity: running ? "pid-123" : null,
                    },
                },
            },
        });
        const phases = [
            "prepared",
            "stopping",
            "writing",
            "restoring-enablement",
            ...(running ? ["starting" as const] : []),
            "verifying",
            "releasing",
            "completed",
        ] as const;
        for (let index = 0; index < phases.length; index++) {
            const phase = phases[index];
            test.journal.save({ ...record, phase });
            for (const forbidden of phases.filter(
                (_, candidate) => candidate < index || candidate > index + 1,
            ))
                expect(() => test.journal.save({ ...record, phase: forbidden })).toThrow();
            if (!running)
                expect(() => test.journal.save({ ...record, phase: "starting" })).toThrow();
            expect(test.journal.read(record.id).phase).toBe(phase);
        }
        const completed = { ...record, phase: "completed" as const, status: "succeeded" as const };
        test.journal.save(completed);
        test.journal.save(completed);
        expect(test.journal.health().recoveryRequired).toBe(false);
    });
    it("rejects upgrade removal phases even when forged on disk", () => {
        const test = journal();
        const record = test.journal.prepare({
            id: "upgrade",
            action: "upgrade",
            desiredEnabled: true,
            ...fixture(),
        });
        for (const phase of [
            "removing",
            "removing-definition",
            "unregistering",
            "removing-metadata",
        ] as const) {
            expect(() => parseManagerServiceRecord({ ...record, phase })).toThrow();
            const bytes = JSON.stringify({ ...record, phase });
            fs.writeFileSync(path.join(test.root, "upgrade.json"), bytes);
            const cold = new FileManagerServiceJournal(test.root);
            expect(cold.health().recoveryRequired).toBe(true);
            expect(() => cold.recoverable(record.id)).toThrow();
            expect(fs.readFileSync(path.join(test.root, "upgrade.json"), "utf8")).toBe(bytes);
        }
    });
    it("requires upgrade payload exclusively and does not repurpose uninstall removal", () => {
        const test = journal();
        const { spec, upgrade } = fixture();
        const input = { id: "upgrade", action: "upgrade" as const, desiredEnabled: true, spec };
        expect(() => test.journal.prepare(input)).toThrow();
        expect(() => test.journal.prepare({ ...input, upgrade: undefined })).toThrow();
        for (const action of ["start", "stop", "restart", "install", "uninstall"] as const)
            expect(() => test.journal.prepare({ ...input, action, upgrade })).toThrow();
        expect(() =>
            test.journal.prepare({ ...input, upgrade, removal: upgrade.snapshot }),
        ).toThrow();
        expect(fs.readdirSync(test.root)).toEqual([]);
    });
    it("refuses changing target-independent immutable upgrade evidence", () => {
        const test = journal();
        const { spec, upgrade } = fixture();
        const record = test.journal.prepare({
            id: "upgrade",
            action: "upgrade",
            desiredEnabled: true,
            spec,
            upgrade,
        });
        const original = fs.readFileSync(path.join(test.root, "upgrade.json"));
        for (const changed of [
            { ...upgrade, candidateDigest: "c".repeat(64) },
            { ...upgrade, previousCandidateDigest: "c".repeat(64) },
            { ...upgrade, previousSpec: { ...upgrade.previousSpec, binPath: "/tmp/another.js" } },
            {
                ...upgrade,
                snapshot: {
                    ...upgrade.snapshot,
                    files: {
                        ...upgrade.snapshot.files,
                        definition: { ...upgrade.snapshot.files.definition, ino: "4" },
                    },
                },
            },
        ])
            expect(() => test.journal.save({ ...record, upgrade: changed })).toThrow();
        expect(fs.readFileSync(path.join(test.root, "upgrade.json"))).toEqual(original);
    });
    it.each(["scope", "workspace", "host", "port", "nodePath"] as const)(
        "rejects changing %s across candidates",
        key => {
            const { spec, upgrade } = fixture();
            const changed = {
                scope: "system",
                workspace: "/tmp/other",
                host: "0.0.0.0",
                port: 7000,
                nodePath: "/bin/node",
            };
            expect(() =>
                parseManagerServiceUpgrade(
                    { ...upgrade, previousSpec: { ...upgrade.previousSpec, [key]: changed[key] } },
                    spec,
                    true,
                ),
            ).toThrow();
        },
    );
    it("rejects invalid digests, incomplete process identity, enablement drift and open payloads", () => {
        const { spec, upgrade } = fixture();
        for (const changed of [
            { ...upgrade, candidateDigest: upgrade.previousCandidateDigest },
            ...["A".repeat(64), "b".repeat(63), 10, null].flatMap(value => [
                { ...upgrade, candidateDigest: value },
                { ...upgrade, previousCandidateDigest: value },
            ]),
            { ...upgrade, token: "synthetic-secret" },
            { ...upgrade, snapshot: { ...upgrade.snapshot, platform: "win32" } },
            ...[
                { processId: 123, identity: null },
                { enabled: false },
            ].map(initial => ({
                ...upgrade,
                snapshot: {
                    ...upgrade.snapshot,
                    initial: { ...upgrade.snapshot.initial, ...initial },
                },
            })),
        ])
            expect(() => parseManagerServiceUpgrade(changed, spec, true)).toThrow();
        expect(
            parseManagerServiceUpgrade(
                {
                    ...upgrade,
                    snapshot: {
                        ...upgrade.snapshot,
                        initial: { enabled: true, processId: 123, identity: "pid-123" },
                    },
                },
                spec,
                true,
            ),
        ).toMatchObject({ snapshot: { initial: { processId: 123, identity: "pid-123" } } });
    });
    it("rejects accessors without reading them", () => {
        const { spec, upgrade } = fixture();
        let read = false;
        Object.defineProperty(upgrade, "candidateDigest", {
            enumerable: true,
            get() {
                read = true;
                return "b".repeat(64);
            },
        });
        expect(() => parseManagerServiceUpgrade(upgrade, spec, true)).toThrow();
        expect(read).toBe(false);
    });
});
