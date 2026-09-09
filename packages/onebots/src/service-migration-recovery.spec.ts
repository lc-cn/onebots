import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireControlWorkspace } from "./control/workspace.js";
import { ServiceMigrationRollbackCoordinator } from "./service-migration-effect-proof.js";
import { createServiceMigrationFilePlan } from "./service-migration-file-plan.js";
import { ServiceMigrationFiles } from "./service-migration-files.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import {
    createServiceMigrationRollbackContract,
    digestServiceMigrationReloadOldReceipt,
    parseRetainedLegacyRuntime,
    retainedRollbackFiles,
} from "./service-migration-retained-runtime.js";
import { recoverInterruptedServiceMigrationV2 } from "./service-migration-cold-recovery.js";
import {
    blockServiceMigrationWorkspace,
    prepareServiceMigrationWorkspace,
} from "./service-migration-workspace.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatformState } from "./service-platform.js";
import type {
    ServiceMigrationBackup,
    ServiceMigrationFile,
    ServiceMigrationRecord,
} from "./service-migration-types.js";

vi.mock("./service-migration-retained-runtime.js", async importOriginal => ({
    ...(await importOriginal<typeof import("./service-migration-retained-runtime.js")>()),
    verifyRetainedLegacyRuntime: vi.fn(async () => undefined),
}));

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(
    previousRunning = true,
    initialPhase: "target-written" | "reloading-old" = "reloading-old",
) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "migration-recovery-")));
    roots.push(root);
    const host: ServiceHost = {
        platform: "linux",
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: () => "",
        spawn: async () => 0,
    };
    const paths = getServiceFiles("user", host);
    const workspace = path.join(root, "workspace");
    const original = {
        scope: "user" as const,
        configPath: path.join(workspace, "old.yaml"),
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: path.join(root, "source", "lib", "bin.js"),
        workingDirectory: path.join(root, "source"),
    };
    const runtimeRoot = path.join(root, "retained", "runtime");
    const nodeRoot = path.join(root, "retained", "node");
    const retainedRuntime = parseRetainedLegacyRuntime({
        schemaVersion: 1,
        sourceRoot: original.workingDirectory,
        runtime: {
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000001",
            root: runtimeRoot,
            digest: "1".repeat(64),
        },
        node: {
            schemaVersion: 1,
            tree: {
                schemaVersion: 1,
                id: "00000000-0000-4000-8000-000000000002",
                root: nodeRoot,
                digest: "2".repeat(64),
            },
            version: process.version,
            platform: "linux",
            arch: process.arch,
        },
        original,
        rollback: {
            ...original,
            nodePath: path.join(nodeRoot, "node"),
            binPath: path.join(runtimeRoot, "lib", "bin.js"),
            workingDirectory: runtimeRoot,
        },
    });
    const source = (role: ServiceMigrationFile["role"], file: string, text: string) => {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, text, { mode: 0o600 });
        return {
            role,
            path: file,
            mode: 0o600,
            contentBase64: Buffer.from(text).toString("base64"),
        };
    };
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        previousRunning,
        previousEnabled: true,
        retainedRuntime,
        files: [
            source("definition", paths.definition, "old definition"),
            source("metadata", paths.metadata, JSON.stringify(original)),
            source("configuration", original.configPath, "general: {}\n"),
        ],
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace,
            nodePath: process.execPath,
            binPath: path.join(root, "manager.js"),
            workingDirectory: workspace,
            host: "127.0.0.1",
            port: 6727,
        },
    };
    const files = new ServiceMigrationFiles(
        backup,
        createServiceMigrationFilePlan(backup, host).files,
        retainedRollbackFiles(backup, host),
    );
    const journalDirectory = path.join(root, "journal");
    const journal = new FileServiceMigrationJournal(journalDirectory);
    let record = journal.prepare("cold", backup);
    journal.save({ ...record, phase: "writing-target" });
    files.apply();
    prepareServiceMigrationWorkspace(workspace, record.id, previousRunning ? "running" : "stopped");
    const release = acquireControlWorkspace(workspace);
    try {
        prepareServiceProcessOwnershipSeed(workspace);
        if (initialPhase === "reloading-old") blockServiceMigrationWorkspace(workspace, record.id);
    } finally {
        release();
    }
    record = journal.read(record.id);
    record = journal.transition(record, { type: "target-written" });
    if (initialPhase === "reloading-old") {
        record = journal.transition(record, {
            type: "begin-rollback",
            origin: "target-written",
        });
        record = journal.transition(record, { type: "restoring" });
        files.restore();
        record = journal.transition(record, { type: "reloading-old" });
    }
    const rollback = createServiceMigrationRollbackContract(backup, host);
    const definition = rollback.contract.files.find(file => file.role === "definition")!;
    const reloadReceipt = {
        schemaVersion: 1 as const,
        backupDigest: record.backupDigest,
        rollbackContractDigest: rollback.digest,
        enabled: backup.previousEnabled,
        loaded: true,
        definitionPath: definition.path,
    };
    const running: ServicePlatformState = {
        state: "running",
        running: true,
        enabled: true,
        loaded: true,
        definitionPath: definition.path,
        processId: 42,
        identity: "old-instance",
        quiescent: false,
    };
    return {
        backup,
        host,
        files,
        journal,
        journalDirectory,
        record,
        reloadReceipt,
        running,
    };
}

async function stage(target: "reloading-old" | "starting-old" | "verifying-restored") {
    const test = fixture();
    let record = test.record;
    if (target !== "reloading-old") {
        const coordinator = new ServiceMigrationRollbackCoordinator(
            test.journal,
            {
                reloadOriginal: async () => test.reloadReceipt,
                startOriginal: async () => ({
                    schemaVersion: 1,
                    reloadReceiptDigest: digestServiceMigrationReloadOldReceipt(test.reloadReceipt),
                    processId: test.running.processId!,
                    identity: test.running.identity!,
                }),
                verifyRestored: async () => true,
            },
            test.backup,
        );
        record = await coordinator.reload(record);
        if (target === "verifying-restored") record = await coordinator.start(record);
    }
    const journal = new FileServiceMigrationJournal(test.journalDirectory);
    return { ...test, journal, record: journal.read(record.id) };
}

describe("v2 cold service migration recovery", () => {
    it("quiesces and restores a never-started stopped target under its workspace lock", async () => {
        const test = fixture(false, "target-written");
        const journal = new FileServiceMigrationJournal(test.journalDirectory);
        const record = journal.read(test.record.id);
        let state: ServicePlatformState = {
            ...test.running,
            state: "stopped",
            running: false,
            processId: null,
            identity: null,
            quiescent: true,
        };
        const quiesce = vi.fn(async () => {
            state = { ...state, enabled: false };
        });
        const reload = vi.fn(async (enabled: boolean) => {
            state = { ...state, enabled };
            return { ...state };
        });
        const result = await recoverInterruptedServiceMigrationV2({
            ...test,
            journal,
            record,
            platform: { inspect: async () => ({ ...state }), quiesce, reload, start: vi.fn() },
        });
        expect(result).toMatchObject({ phase: "completed", rolledBack: true });
        expect(quiesce).toHaveBeenCalledOnce();
        expect(reload).toHaveBeenCalledWith(true);
        expect(test.files.matchesRestored()).toBe(true);
    });

    it("blocks a process-reopened reloading intent instead of replaying daemon reload", async () => {
        const test = await stage("reloading-old");
        const reload = vi.fn();
        await expect(
            recoverInterruptedServiceMigrationV2({
                ...test,
                platform: {
                    inspect: async () => ({ ...test.running, state: "stopped", running: false }),
                    quiesce: vi.fn(),
                    reload,
                    start: vi.fn(),
                },
            }),
        ).rejects.toThrow();
        expect(reload).not.toHaveBeenCalled();
        expect(test.journal.read(test.record.id).phase).toBe("reloading-old");
    });

    it("reconciles an already-running old instance when its start receipt was not persisted", async () => {
        const test = await stage("starting-old");
        const start = vi.fn();
        const result = await recoverInterruptedServiceMigrationV2({
            ...test,
            platform: {
                inspect: async () => ({ ...test.running }),
                quiesce: vi.fn(),
                reload: vi.fn(),
                start,
            },
        });
        expect(result).toMatchObject({ phase: "completed", rolledBack: true });
        expect(result.startOldReceipt).toMatchObject({ processId: 42, identity: "old-instance" });
        expect(start).not.toHaveBeenCalled();
    });

    it("rejects instance replacement while re-verifying a persisted restored receipt", async () => {
        const test = await stage("verifying-restored");
        await expect(
            recoverInterruptedServiceMigrationV2({
                ...test,
                platform: {
                    inspect: async () => ({
                        ...test.running,
                        processId: 99,
                        identity: "replacement",
                    }),
                    quiesce: vi.fn(),
                    reload: vi.fn(),
                    start: vi.fn(),
                },
            }),
        ).rejects.toThrow();
        expect(test.journal.read(test.record.id)).toMatchObject({
            phase: "verifying-restored",
            recoveryRequired: true,
        });
    });
});
