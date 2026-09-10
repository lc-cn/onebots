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
    stopAtWorkspaceLock: true,
    stateDir: "/state",
    definition: "/definition",
    metadata: "/metadata",
    verifyFiles: false,
    markerPhase: undefined as undefined | "released",
    windowsCandidates: false,
    candidateReads: 0,
    confirmUnloadedProcesses: undefined as (() => Promise<boolean>) | undefined,
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
        directory: state.windowsCandidates
            ? state.candidateReads++ === 0
                ? state.previousDirectory
                : state.targetDirectory
            : url.includes("/previous/")
              ? state.previousDirectory
              : state.targetDirectory,
    }),
    managerCandidateDigest: (candidate: { directory: string }) =>
        candidate.directory === state.previousDirectory ? "a".repeat(64) : "b".repeat(64),
}));
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: vi.fn(),
}));
vi.mock("./manager-service-removal.js", () => ({
    captureManagerServiceRemoval: (spec: { workingDirectory: string }) => ({
        verifyRemaining: () => {
            if (!state.verifyFiles) return true;
            const expected =
                spec.workingDirectory === state.previousDirectory ? "old.js" : "new.js";
            return fs.readFileSync(state.definition, "utf8").includes(expected);
        },
        dispose: vi.fn(),
    }),
}));
vi.mock("./service-files.js", () => ({
    getServiceFiles: () => ({
        stateDir: state.stateDir,
        definition: state.definition,
        metadata: state.metadata,
    }),
}));
vi.mock("./service-migration-lock.js", () => ({
    acquireServiceMigrationLock: () => vi.fn(),
}));
vi.mock("./service-migration-workspace.js", () => ({ readServiceMigrationPending: () => null }));
vi.mock("./service-migration-processes.js", () => ({
    verifyServiceMigrationProcesses: vi.fn(async () => {
        state.effects.push("process-proof-locking");
        return true;
    }),
    verifyServiceMigrationProcessesWhileLocked: vi.fn(async () => {
        state.effects.push("process-proof-while-locked");
        return true;
    }),
}));
vi.mock("./service-platform-launchd.js", () => ({
    LaunchdServicePlatform: class {
        constructor(
            _host: unknown,
            _scope: unknown,
            _definition: unknown,
            options: { confirmUnloadedProcesses(): Promise<boolean> },
        ) {
            state.confirmUnloadedProcesses = options.confirmUnloadedProcesses;
        }
        async inspect() {
            await state.confirmUnloadedProcesses?.();
            throw new Error("stop after process proof");
        }
    },
}));
vi.mock("./service-upgrade-workspace.js", () => ({
    readManagerUpgradePending: () => ({
        schemaVersion: 1,
        operationId: "upgrade",
        candidateDigest: "b".repeat(64),
        ...(state.markerPhase
            ? { phase: state.markerPhase, completion: "rollback", managerId: "manager" }
            : {}),
    }),
    completeRolledBackManagerUpgradeWhileLocked: vi.fn(() => {
        state.markerPhase = "released";
    }),
}));
vi.mock("./windows-service-security.js", () => ({
    inspectWindowsServiceDirectorySecurity: vi.fn(),
    inspectWindowsServiceFileSecurity: vi.fn(),
    secureWindowsServiceFile: vi.fn(),
}));
vi.mock("./control/workspace.js", () => ({
    acquireControlWorkspace: (root: string) => {
        if (root === state.workspace) {
            state.effects.push("workspace-lock");
            if (state.stopAtWorkspaceLock) throw new Error("stop after observing workspace lock");
        }
        return vi.fn();
    },
}));

import { rollbackManagerServiceUpgrade } from "./manager-service-upgrade-rollback.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";

const roots: string[] = [];
afterEach(() => {
    vi.clearAllMocks();
    state.effects = [];
    state.stopAtWorkspaceLock = true;
    state.stateDir = "/state";
    state.definition = "/definition";
    state.metadata = "/metadata";
    state.verifyFiles = false;
    state.markerPhase = undefined;
    state.windowsCandidates = false;
    state.candidateReads = 0;
    state.confirmUnloadedProcesses = undefined;
    state.record = undefined;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("launchd 回退持有 workspace 锁时复用锁内进程证明", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-upgrade-proof-lock-")));
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
        phase: "rollback-reloading",
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
    state.stopAtWorkspaceLock = false;

    await expect(
        rollbackManagerServiceUpgrade("upgrade", "user", {
            platform: "darwin",
            homedir: root,
            uid: process.getuid?.(),
            env: {},
            exec: vi.fn(),
            spawn: vi.fn(),
        }),
    ).rejects.toThrow("管理程序升级回退现场无法确认");
    expect(state.effects).toEqual(["workspace-lock", "process-proof-while-locked"]);
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
    let quiesced = false;
    const platform: ServicePlatform = {
        inspect: async () => {
            if (!quiesced) throw new Error("candidate changed during first observation");
            return structuredClone(platformState);
        },
        quiesce: async () => {
            state.effects.push("quiesce");
            quiesced = true;
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

it("Windows 回退以当前候选定义为 CAS 锚点恢复同一 SCM 服务", async () => {
    const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "ob-win-upgrade-rollback-")),
    );
    roots.push(root);
    state.workspace = path.join(root, "data");
    state.stateDir = path.join(root, "state");
    state.definition = path.join(state.stateDir, "service.json");
    state.metadata = path.join(state.stateDir, "metadata.json");
    state.previousDirectory = path.join(root, "previous", "versions", "old");
    state.targetDirectory = path.join(root, "target", "versions", "new");
    state.stopAtWorkspaceLock = false;
    state.verifyFiles = true;
    state.windowsCandidates = true;
    for (const directory of [
        state.workspace,
        state.stateDir,
        state.previousDirectory,
        state.targetDirectory,
    ])
        fs.mkdirSync(directory, { recursive: true });
    const base = {
        schemaVersion: 1 as const,
        runtimeKind: "control" as const,
        scope: "system" as const,
        workspace: state.workspace,
        nodePath: path.join(root, "node.exe"),
        host: "127.0.0.1",
        port: 6727,
    };
    const previousSpec = {
        ...base,
        binPath: path.join(state.previousDirectory, "old.js"),
        workingDirectory: state.previousDirectory,
    };
    const targetSpec = {
        ...base,
        binPath: path.join(state.targetDirectory, "new.js"),
        workingDirectory: state.targetDirectory,
    };
    fs.writeFileSync(
        state.definition,
        renderInstalledManagerService(targetSpec, "win32", state.stateDir),
    );
    fs.writeFileSync(state.metadata, JSON.stringify(targetSpec) + "\n");
    state.record = {
        id: "upgrade",
        action: "upgrade",
        phase: "rollback-writing",
        status: "interrupted",
        recoveryRequired: true,
        desiredEnabled: true,
        managerSpec: targetSpec,
        upgrade: {
            previousSpec,
            previousCandidateDigest: "a".repeat(64),
            candidateDigest: "b".repeat(64),
            snapshot: {
                platform: "win32",
                initial: { processId: null },
                files: { definition: { mode: 0o600 }, metadata: { mode: 0o600 } },
            },
        },
    };
    const platformState: ServicePlatformState = {
        state: "stopped",
        running: false,
        enabled: false,
        loaded: true,
        definitionPath: state.definition,
        processId: null,
        identity: null,
        quiescent: true,
    };
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(platformState),
        quiesce: async () => structuredClone(platformState),
        reload: async () => {
            throw new Error("Windows 回退不能调用通用 reload");
        },
        start: async () => structuredClone(platformState),
    };
    const replace = vi.fn(async (target: Buffer, enabled: boolean) => {
        expect(target.toString()).toBe(
            renderInstalledManagerService(targetSpec, "win32", state.stateDir),
        );
        platformState.enabled = enabled;
    });

    await expect(
        rollbackManagerServiceUpgrade(
            "upgrade",
            "system",
            {
                platform: "win32",
                homedir: root,
                env: {},
                isElevated: true,
                exec: vi.fn(),
                spawn: vi.fn(),
            },
            { platform, replaceWindowsDefinition: replace },
        ),
    ).resolves.toMatchObject({ phase: "completed", status: "failed", recoveryRequired: false });
    expect(replace).toHaveBeenCalledOnce();
    expect(fs.readFileSync(state.definition, "utf8")).toBe(
        renderInstalledManagerService(previousSpec, "win32", state.stateDir),
    );
    expect(fs.readFileSync(state.metadata, "utf8")).toBe(JSON.stringify(previousSpec) + "\n");
});
