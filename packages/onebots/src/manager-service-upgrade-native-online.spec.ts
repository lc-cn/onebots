import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { FileManagerServiceJournal, type ManagerServicePreparation } from "./manager-service-journal.js";
import { runManagerServiceUpgrade } from "./manager-service-upgrade-transaction.js";
import { createManagerServiceUpgradeNativePort } from "./manager-service-upgrade-native-port.js";
import { prepareServiceMigrationWorkspace, releaseServiceMigrationPending } from "./service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { advanceManagerUpgrade, readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatformState, ServicePlatform } from "./service-platform.js";
import type { MigrationManagerState } from "./service-migration-manager.js";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./manager-service-upgrade-candidate.js", () => ({ verifyManagerServiceCandidate: vi.fn() }));
vi.mock("./client/local-control.js", () => ({ createLocalControlTransport: () => transport }));
vi.mock("./service-migration-manager.js", async importOriginal => ({
    ...await importOriginal<typeof import("./service-migration-manager.js")>(),
    inspectPrivateControlSocket: () => "stable-private-socket",
}));
const roots: string[] = [];
const oldId = "11111111-1111-4111-8111-111111111111";
const newId = "22222222-2222-4222-8222-222222222222";
afterEach(() => {
    vi.resetAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(enabled: boolean, lostResponse = false) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-native-online-")); roots.push(root);
    const host: ServiceHost = { platform: "linux", homedir: root, uid: process.getuid?.(), env: {},
        exec: vi.fn(() => { throw new Error("no OS command"); }), spawn: vi.fn(async () => { throw new Error("no spawn"); }) };
    const workspace = path.join(root, "data"); fs.mkdirSync(workspace, { mode: 0o700 });
    prepareServiceMigrationWorkspace(workspace, "seed", "running");
    const unlock = acquireControlWorkspace(workspace);
    try { prepareServiceProcessOwnershipSeed(workspace); releaseServiceMigrationPending(workspace, "seed"); } finally { unlock(); }
    fs.writeFileSync(path.join(workspace, "config.yaml"), "{}\n");
    const gateway = fs.readFileSync(path.join(workspace, ".control/gateway.json"));
    const previous: ManagerServiceSpec = { schemaVersion: 1, runtimeKind: "control", scope: "user", workspace,
        workingDirectory: root, binPath: path.join(root, "old.js"), nodePath: process.execPath, host: "127.0.0.1", port: 6727 };
    const installation = prepareManagerServiceInstallation(previous, host);
    try { installation.apply(); } finally { installation.dispose(); }
    const capture = captureManagerServiceRemoval(previous, host);
    const snapshot = structuredClone(capture.snapshot); capture.dispose();
    const files = getServiceFiles("user", host);
    const previousPid = process.pid + 100, candidatePid = process.pid + 101;
    const preparation: ManagerServicePreparation = { id: "upgrade", action: "upgrade", desiredEnabled: enabled,
        spec: { ...previous, binPath: path.join(root, "new.js") }, upgrade: { previousSpec: previous,
            previousCandidateDigest: "a".repeat(64), candidateDigest: "b".repeat(64),
            snapshot: { platform: "linux", files: snapshot, initial: { enabled, processId: previousPid, identity: "old-invocation" } } } };
    const state: ServicePlatformState = { state: "running", running: true, quiescent: false, enabled,
        loaded: true, processId: previousPid, identity: "old-invocation", definitionPath: files.definition };
    const manager: MigrationManagerState = {
        schemaVersion: 1, manager: { id: oldId, version: "1.2.3", pid: previousPid },
        gateway: { desired: "running", actual: "running", recoveryRequired: false },
        serviceMigration: { pending: false, recoveryRequired: false }, knownConfigurationFailure: false,
    };
    const observations: MigrationManagerState[] = [];
    const effects: string[] = [];
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => {
            effects.push("quiesce");
            Object.assign(state, { state: "stopped", running: false, quiescent: true, enabled: false, processId: null });
        },
        reload: async value => { effects.push("reload"); state.enabled = value; },
        start: async () => {
            effects.push("start");
            expect(readManagerUpgradePending(workspace)).toMatchObject({ operationId: "upgrade", candidateDigest: "b".repeat(64) });
            Object.assign(state, { state: "running", running: true, quiescent: false, processId: candidatePid, identity: "new-invocation" });
            manager.manager = { id: newId, version: "1.2.4", pid: candidatePid };
            manager.gateway.actual = "stopped";
            manager.serviceMigration.pending = true;
        },
    };
    transport.request.mockImplementation(async (method, route, body) => {
        expect(method).toBe("POST"); expect(route).toBe("/api/control/service-upgrade/release");
        expect(body).toEqual({ operationId: "upgrade", candidateDigest: "b".repeat(64), managerId: newId });
        expect(manager.gateway.actual).toBe("stopped");
        const releaseLock = acquireControlWorkspace(workspace);
        try {
            const marker = readManagerUpgradePending(workspace)!;
            advanceManagerUpgrade(workspace, marker, "releasing", newId);
            manager.gateway.actual = "running";
            manager.gateway.instance = { id: "33333333-3333-4333-8333-333333333333", pid: candidatePid + 1, address: { host: "127.0.0.1", port: 12345 } };
            advanceManagerUpgrade(workspace, readManagerUpgradePending(workspace)!, "released", newId);
            manager.serviceMigration.pending = false;
        } finally { releaseLock(); }
        if (lostResponse) throw new Error("release response lost");
        return { released: true };
    });
    const journal = new FileManagerServiceJournal(path.join(root, "operations"));
    const port = createManagerServiceUpgradeNativePort(host, {
        platform, inspectManager: async () => {
            const observed = structuredClone(manager); observations.push(observed); return observed;
        },
    });
    return { workspace, gateway, preparation, state, manager, effects, observations, journal, files, port };
}
it.each([true, false])("原运行服务在线切换只启停一次，并保留 enabled=%s", async enabled => {
    const f = fixture(enabled);
    const result = await runManagerServiceUpgrade(f.preparation, f.journal, f.port);
    expect(result).toMatchObject({ phase: "completed", status: "succeeded", recoveryRequired: false });
    expect(f.effects).toEqual(["quiesce", "reload", "start"]);
    expect(f.state).toMatchObject({ running: true, enabled });
    expect(f.observations[0].manager.id).toBe(oldId);
    expect(f.observations.some(value => value.manager.id === newId && value.gateway.actual === "stopped" && value.serviceMigration.pending)).toBe(true);
    expect(f.observations.at(-1)).toMatchObject({ manager: { id: newId }, serviceMigration: { pending: false }, gateway: { actual: "running" } });
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({ phase: "released", managerId: newId });
    expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(f.preparation.spec);
    expect(fs.readFileSync(path.join(f.workspace, ".control/gateway.json"))).toEqual(f.gateway);
});
it("释放成功但响应丢失保留真实完成回执和日志恢复状态，不重派", async () => {
    const f = fixture(true, true);
    await expect(runManagerServiceUpgrade(f.preparation, f.journal, f.port)).rejects.toThrow();
    expect(f.journal.read("upgrade")).toMatchObject({ phase: "releasing", status: "interrupted", recoveryRequired: true });
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({ phase: "released", managerId: newId });
    expect(f.manager.serviceMigration.pending).toBe(false);
    await expect(runManagerServiceUpgrade(f.preparation, f.journal, f.port)).rejects.toThrow();
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(f.effects).toEqual(["quiesce", "reload", "start"]);
});
