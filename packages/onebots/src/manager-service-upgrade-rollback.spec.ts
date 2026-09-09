import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    record: undefined as Record<string, unknown> | undefined,
    workspace: "",
    previousDirectory: "",
    targetDirectory: "",
    effects: [] as string[],
}));

vi.mock("./manager-service-journal.js", () => ({
    FileManagerServiceJournal: class {
        recoverable() {
            return structuredClone(state.record);
        }
        read() {
            return structuredClone(state.record);
        }
        save(value: Record<string, unknown>) {
            state.record = structuredClone(value);
        }
    },
}));
vi.mock("./manager-runtime/identity.js", () => ({
    readRunningManagerCandidate: (url: string) => ({
        directory: url.includes("/previous/") ? state.previousDirectory : state.targetDirectory,
    }),
    managerCandidateDigest: (candidate: { directory: string }) =>
        candidate.directory === state.previousDirectory ? "a".repeat(64) : "b".repeat(64),
}));
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: vi.fn(),
}));
vi.mock("./manager-service-removal.js", () => ({
    captureManagerServiceRemoval: () => ({ verifyRemaining: () => true, dispose: vi.fn() }),
}));
vi.mock("./service-files.js", () => ({
    getServiceFiles: () => ({
        stateDir: "/state",
        definition: "/definition",
        metadata: "/metadata",
    }),
}));
vi.mock("./service-migration-lock.js", () => ({
    acquireServiceMigrationLock: () => vi.fn(),
}));
vi.mock("./service-migration-workspace.js", () => ({ readServiceMigrationPending: () => null }));
vi.mock("./service-upgrade-workspace.js", () => ({
    readManagerUpgradePending: () => ({
        schemaVersion: 1,
        operationId: "upgrade",
        candidateDigest: "b".repeat(64),
    }),
    completeRolledBackManagerUpgradeWhileLocked: vi.fn(),
}));
vi.mock("./control/workspace.js", () => ({
    acquireControlWorkspace: (root: string) => {
        if (root === state.workspace) {
            state.effects.push("workspace-lock");
            throw new Error("stop after observing workspace lock");
        }
        return vi.fn();
    },
}));

import { rollbackManagerServiceUpgrade } from "./manager-service-upgrade-rollback.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";

const roots: string[] = [];
afterEach(() => {
    vi.clearAllMocks();
    state.effects = [];
    state.record = undefined;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("verifying 中断回退先静止自动重启服务，再获取 workspace 锁", async () => {
    const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "ob-upgrade-rollback-order-")),
    );
    roots.push(root);
    state.workspace = path.join(root, "data");
    state.previousDirectory = path.join(
        root,
        "previous",
        "versions",
        "11111111-1111-4111-8111-111111111111",
    );
    state.targetDirectory = path.join(
        root,
        "target",
        "versions",
        "22222222-2222-4222-8222-222222222222",
    );
    for (const directory of [state.previousDirectory, state.targetDirectory])
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    state.record = {
        id: "upgrade",
        action: "upgrade",
        phase: "verifying",
        status: "interrupted",
        recoveryRequired: true,
        desiredEnabled: true,
        managerSpec: {
            scope: "user",
            workspace: state.workspace,
            workingDirectory: state.targetDirectory,
            binPath: path.join(state.targetDirectory, "new.js"),
        },
        upgrade: {
            previousSpec: {
                workingDirectory: state.previousDirectory,
                binPath: path.join(state.previousDirectory, "old.js"),
            },
            previousCandidateDigest: "a".repeat(64),
            candidateDigest: "b".repeat(64),
            snapshot: { initial: { processId: 123 }, files: {} },
        },
    };
    const platformState: ServicePlatformState = {
        state: "running",
        running: true,
        enabled: true,
        loaded: true,
        definitionPath: "/definition",
        processId: 456,
        identity: "auto-restart-generation",
        quiescent: false,
    };
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(platformState),
        quiesce: async () => {
            state.effects.push("quiesce");
            Object.assign(platformState, {
                state: "stopped",
                running: false,
                enabled: false,
                processId: null,
                identity: null,
                quiescent: true,
            });
        },
        reload: async () => platformState,
        start: async () => platformState,
    };

    await expect(
        rollbackManagerServiceUpgrade(
            "upgrade",
            "user",
            {
                platform: "linux",
                homedir: root,
                uid: process.getuid?.(),
                env: {},
                exec: vi.fn(),
                spawn: vi.fn(),
            },
            { platform },
        ),
    ).rejects.toThrow("管理程序升级回退现场无法确认");
    expect(state.effects).toEqual(["quiesce", "workspace-lock"]);
    expect(state.record).toMatchObject({
        phase: "rollback-stopping",
        status: "interrupted",
        recoveryRequired: true,
    });
});
