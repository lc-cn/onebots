import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServiceMigrationPort } from "./service-migration-port.js";
import { ServiceMigrationTransaction } from "./service-migration-transaction.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { getServiceFiles } from "./service-files.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import {
    readServiceMigrationPending,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatformState, ServicePlatform } from "./service-platform.js";
import type { ServiceMigrationBackup, ServiceMigrationFile } from "./service-migration-types.js";
import type { MigrationManagerState } from "./service-migration-manager.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(running = true) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/migration-port-"));
    roots.push(root);
    const host: ServiceHost = {
        platform: "linux",
        homedir: root,
        env: {},
        exec: () => {
            throw new Error("unexpected OS command");
        },
        spawn: async () => {
            throw new Error("unexpected OS spawn");
        },
    };
    const paths = getServiceFiles("user", host);
    const workspace = path.join(root, "workspace");
    const legacy = {
        scope: "user",
        configPath: path.join(workspace, "old.yaml"),
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        workingDirectory: workspace,
    };
    const files = (
        [
            ["definition", paths.definition, "old unit"],
            ["metadata", paths.metadata, JSON.stringify(legacy)],
            ["configuration", legacy.configPath, "general: {}\n"],
        ] as const
    ).map(([role, file, content]): ServiceMigrationFile => {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, content, { mode: 0o600 });
        return {
            role,
            path: file,
            mode: 0o600,
            contentBase64: Buffer.from(content).toString("base64"),
        };
    });
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        previousRunning: running,
        previousEnabled: true,
        files,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace,
            workingDirectory: workspace,
            nodePath: process.execPath,
            binPath: "/app/bin.js",
            host: "127.0.0.1",
            port: 6727,
        },
    };
    let state: ServicePlatformState = {
        state: running ? "running" : "stopped",
        running,
        enabled: true,
        loaded: true,
        definitionPath: paths.definition,
        processId: running ? 100 : null,
        identity: running ? "old-identity" : null,
        quiescent: !running,
    };
    const originalState = structuredClone(state);
    const events: string[] = [];
    const controls = {
        proof: true,
        invalidGateway: false,
        wrongPid: false,
        managerId: "10000000-0000-4000-8000-000000000001",
    };
    const isTarget = () =>
        JSON.parse(fs.readFileSync(paths.metadata, "utf8")).runtimeKind === "control";
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => {
            events.push("quiesce");
            state = {
                ...state,
                state: "stopped",
                running: false,
                processId: null,
                identity: null,
                quiescent: true,
            };
        },
        reload: async enabled => {
            const target = isTarget();
            events.push(target ? "reload-target" : "reload-old");
            if (target) {
                expect(fs.existsSync(path.join(workspace, "config.yaml"))).toBe(true);
                expect(readServiceMigrationPending(workspace)?.operationId).toBe("migration-1");
                expect(
                    JSON.parse(
                        fs.readFileSync(path.join(workspace, ".control/gateway.json"), "utf8"),
                    ).desired,
                ).toBe(running ? "running" : "stopped");
            }
            state = { ...state, enabled };
        },
        start: async () => {
            const target = isTarget();
            events.push(target ? "start-target" : "start-old");
            if (!target)
                expect(fs.existsSync(path.join(workspace, ".control/migration-blocked.json"))).toBe(
                    true,
                );
            state = {
                ...state,
                state: "running",
                running: true,
                processId: target ? 200 : 300,
                identity: target ? "target-identity" : "restored-identity",
                quiescent: false,
            };
        },
    };
    const manager = {
        inspect: vi.fn(
            async (): Promise<MigrationManagerState> => ({
                schemaVersion: 1,
                manager: {
                    id: controls.managerId,
                    version: "1.0.0",
                    pid: controls.wrongPid ? 999 : 200,
                },
                gateway: {
                    desired: "running",
                    actual: controls.invalidGateway ? "failed" : "running",
                    recoveryRequired: false,
                },
                serviceMigration: { pending: true, recoveryRequired: false },
                knownConfigurationFailure: false,
            }),
        ),
        release: vi.fn(async (_workspace: string, id: string) => {
            events.push("release");
            const unlock = acquireControlWorkspace(workspace);
            try {
                releaseServiceMigrationPending(workspace, id);
            } finally {
                unlock();
            }
        }),
    };
    let time = 0;
    const port = createServiceMigrationPort({
        backup,
        host,
        platform,
        operationId: "migration-1",
        originalState,
        confirmStopped: async () => controls.proof,
        manager,
        readinessTimeoutMs: 10,
        now: () => time,
        sleep: async milliseconds => {
            time += milliseconds;
        },
    });
    const journal = new FileServiceMigrationJournal(path.join(root, "journal"));
    return {
        root,
        workspace,
        backup,
        events,
        controls,
        port,
        manager,
        journal,
        transaction: new ServiceMigrationTransaction(journal, port),
        getState: () => state,
        setState: (next: ServicePlatformState) => {
            state = next;
        },
    };
}
describe("real service migration port file boundaries", () => {
    it("running migration writes files and seed before reload/start and releases only after verification", async () => {
        const test = fixture();
        const result = await test.transaction.run("migration-1", test.backup);
        expect(result.status).toBe("succeeded");
        expect(test.events).toEqual(["quiesce", "reload-target", "start-target", "release"]);
        expect(test.manager.inspect).toHaveBeenCalled();
        expect(readServiceMigrationPending(test.workspace)).toBeNull();
    });
    it("previously stopped migration never starts a manager and preserves stopped seed after release", async () => {
        const test = fixture(false);
        expect((await test.transaction.run("migration-1", test.backup)).status).toBe("succeeded");
        expect(test.events).toEqual(["quiesce", "reload-target"]);
        expect(test.manager.inspect).not.toHaveBeenCalled();
        expect(readServiceMigrationPending(test.workspace)).toBeNull();
        expect(
            JSON.parse(fs.readFileSync(path.join(test.workspace, ".control/gateway.json"), "utf8"))
                .desired,
        ).toBe("stopped");
    });
    it("false stop proof forbids any file write or automatic restart", async () => {
        const test = fixture();
        test.controls.proof = false;
        expect((await test.transaction.run("migration-1", test.backup)).recoveryRequired).toBe(
            true,
        );
        expect(test.events).toEqual(["quiesce"]);
        expect(fs.existsSync(path.join(test.workspace, ".control"))).toBe(false);
        for (const file of test.backup.files)
            expect(fs.readFileSync(file.path).toString("base64")).toBe(file.contentBase64);
    });
    it("manager PID mismatch fails readiness; changed manager identity prevents pending release", async () => {
        const test = fixture();
        await test.port.stopOriginal(test.backup);
        await test.port.writeTarget(test.backup);
        await test.port.startTarget(test.backup);
        test.controls.wrongPid = true;
        expect(await test.port.verifyTarget(test.backup)).toBe(false);
        test.controls.wrongPid = false;
        expect(await test.port.verifyTarget(test.backup)).toBe(true);
        test.controls.managerId = "10000000-0000-4000-8000-000000000002";
        await expect(test.port.releaseTarget(test.backup)).rejects.toThrow();
        expect(test.manager.release).not.toHaveBeenCalled();
    });
    it("failed target readiness blocks the workspace before restarting the restored old service", async () => {
        const test = fixture();
        test.controls.invalidGateway = true;
        const result = await test.transaction.run("migration-1", test.backup);
        expect(result).toMatchObject({
            status: "failed",
            rolledBack: true,
            recoveryRequired: false,
        });
        expect(test.events).toEqual([
            "quiesce",
            "reload-target",
            "start-target",
            "quiesce",
            "reload-old",
            "start-old",
        ]);
        expect(() => readServiceMigrationPending(test.workspace)).toThrow();
        for (const file of test.backup.files)
            expect(fs.readFileSync(file.path).toString("base64")).toBe(file.contentBase64);
    });
    it("partial workspace preparation remains unknown and never automatically restores or restarts", async () => {
        const test = fixture();
        const original = fs.linkSync;
        vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
            if (String(to).endsWith("gateway.json")) throw new Error("synthetic-secret");
            original(from, to);
        });
        const result = await test.transaction.run("migration-1", test.backup);
        expect(result.recoveryRequired).toBe(true);
        expect(test.events).toEqual(["quiesce"]);
        expect(readServiceMigrationPending(test.workspace)?.operationId).toBe("migration-1");
    });
    it("rollback cannot quiesce a replacement service instance after verified target identity changes", async () => {
        const test = fixture();
        await test.port.stopOriginal(test.backup);
        await test.port.writeTarget(test.backup);
        await test.port.startTarget(test.backup);
        expect(await test.port.verifyTarget(test.backup)).toBe(true);
        test.setState({ ...test.getState(), processId: 999, identity: "external-identity" });
        const count = test.events.length;
        await expect(test.port.stopTarget(test.backup)).rejects.toThrow();
        expect(test.events.length).toBe(count);
    });
});

it("loss of explicit stop proof after target files are written forbids starting the manager", async () => {
    const test = fixture();
    await test.port.stopOriginal(test.backup);
    await test.port.writeTarget(test.backup);
    test.controls.proof = false;
    await expect(test.port.startTarget(test.backup)).rejects.toThrow();
    expect(test.events).toEqual(["quiesce", "reload-target"]);
});
