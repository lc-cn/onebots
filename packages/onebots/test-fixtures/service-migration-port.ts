import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { afterEach, expect, vi } from "vitest";
import { createServiceMigrationPort } from "../src/service-migration-port.js";
import { ServiceMigrationTransaction } from "../src/service-migration-transaction.js";
import { FileServiceMigrationJournal } from "../src/service-migration-journal.js";
import { getServiceFiles } from "../src/service-files.js";
import { acquireControlWorkspace } from "../src/control/workspace.js";
import {
    readServiceMigrationPending,
    releaseServiceMigrationPending,
} from "../src/service-migration-workspace.js";
import { parseRetainedLegacyRuntime } from "../src/service-migration-retained-runtime.js";
import { canonicalServiceJson } from "../src/service-operation-storage.js";
import type { ServiceHost } from "../src/service-host.js";
import type { ServicePlatformState, ServicePlatform } from "../src/service-platform.js";
import type {
    ServiceMigrationBackup,
    ServiceMigrationFile,
} from "../src/service-migration-types.js";
import type { MigrationManagerState } from "../src/service-migration-manager.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
export function fixture(running = true, platformName: "linux" | "darwin" = "linux") {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/migration-port-"));
    roots.push(root);
    const host: ServiceHost = {
        platform: platformName,
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
    const sourceRoot = path.join(root, "legacy-runtime");
    const runtimeRoot = path.join(root, "retained", "runtime");
    const nodeRoot = path.join(root, "retained", "node");
    const legacy = {
        scope: "user",
        configPath: path.join(workspace, "old.yaml"),
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: path.join(sourceRoot, "bin.js"),
        workingDirectory: sourceRoot,
    };
    const rollback = {
        ...legacy,
        nodePath: path.join(nodeRoot, "node"),
        binPath: path.join(runtimeRoot, "bin.js"),
        workingDirectory: runtimeRoot,
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
        retainedRuntime: parseRetainedLegacyRuntime({
            schemaVersion: 1,
            sourceRoot,
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
                version: "v24.0.0",
                platform: platformName,
                arch: "x64",
            },
            original: legacy,
            rollback,
        }),
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
        reloadError: false,
        startRaceState: null as ServicePlatformState | null,
        afterStartState: null as ServicePlatformState | null,
    };
    const isTarget = () =>
        JSON.parse(fs.readFileSync(paths.metadata, "utf8")).runtimeKind === "control";
    const reload = vi.fn(async (enabled: boolean) => {
        const target = isTarget();
        events.push(target ? "reload-target" : "reload-old");
        if (target) {
            expect(fs.existsSync(path.join(workspace, "config.yaml"))).toBe(true);
            expect(readServiceMigrationPending(workspace)?.operationId).toBe("migration-1");
            expect(
                JSON.parse(fs.readFileSync(path.join(workspace, ".control/gateway.json"), "utf8"))
                    .desired,
            ).toBe(running ? "running" : "stopped");
        }
        state = {
            ...state,
            state: "stopped",
            running: false,
            enabled,
            loaded: platformName === "linux",
            definitionPath: paths.definition,
            processId: null,
            identity: null,
            quiescent: true,
        };
        if (controls.reloadError) throw new Error("synthetic reload failure");
        return structuredClone(state);
    });
    const start = vi.fn(async (expectedInitialState?: ServicePlatformState) => {
        if (controls.startRaceState) state = structuredClone(controls.startRaceState);
        if (expectedInitialState && !isDeepStrictEqual(state, expectedInitialState))
            throw new Error("synthetic initial state mismatch");
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
            loaded: true,
            processId: target ? 200 : 300,
            identity: target ? "target-identity" : "restored-identity",
            quiescent: false,
        };
        const result = structuredClone(state);
        if (controls.afterStartState) state = structuredClone(controls.afterStartState);
        return result;
    });
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
        reload,
        start,
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
    const makePort = () =>
        createServiceMigrationPort({
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
    const port = makePort();
    const journal = new FileServiceMigrationJournal(path.join(root, "journal"));
    return {
        root,
        workspace,
        backup,
        events,
        controls,
        port,
        manager,
        host,
        paths,
        platform,
        reload,
        start,
        makePort,
        backupDigest: createHash("sha256").update(canonicalServiceJson(backup)).digest("hex"),
        journal,
        transaction: new ServiceMigrationTransaction(journal, port),
        getState: () => state,
        setState: (next: ServicePlatformState) => {
            state = next;
        },
    };
}

export async function restoreRollback(test: ReturnType<typeof fixture>) {
    await test.port.stopOriginal(test.backup);
    await test.port.writeTarget(test.backup);
    if (test.backup.previousRunning) {
        await test.port.startTarget(test.backup);
        await test.port.stopTarget(test.backup);
    }
    await test.port.restoreOriginal(test.backup);
}
