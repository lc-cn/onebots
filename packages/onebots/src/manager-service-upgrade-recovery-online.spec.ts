import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import {
    FileManagerServiceJournal,
    type ManagerServicePreparation,
} from "./manager-service-journal.js";
import { runManagerServiceUpgrade } from "./manager-service-upgrade-transaction.js";
import { createManagerServiceUpgradeNativePort } from "./manager-service-upgrade-native-port.js";
import {
    prepareServiceMigrationWorkspace,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { advanceManagerUpgrade, readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatformState, ServicePlatform } from "./service-platform.js";
import type { MigrationManagerState } from "./service-migration-manager.js";

import { verifyReleasedManagerServiceUpgrade } from "./manager-service-upgrade-recovery.js";
import { inspectMigrationManager } from "./service-migration-manager.js";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: vi.fn(),
}));
vi.mock("./client/local-control.js", () => ({ createLocalControlTransport: () => transport }));
vi.mock("./service-migration-manager.js", async importOriginal => ({
    ...(await importOriginal<typeof import("./service-migration-manager.js")>()),
    inspectPrivateControlSocket: () => "stable-private-socket",
    inspectMigrationManager: vi.fn(),
}));
const roots: string[] = [];
const oldId = "11111111-1111-4111-8111-111111111111";
const newId = "22222222-2222-4222-8222-222222222222";
afterEach(() => {
    vi.resetAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(enabled: boolean, lostResponse = false) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-recovery-online-"));
    roots.push(root);
    const host: ServiceHost = {
        platform: "linux",
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: vi.fn(() => {
            throw new Error("no OS command");
        }),
        spawn: vi.fn(async () => {
            throw new Error("no spawn");
        }),
    };
    const workspace = path.join(root, "data");
    fs.mkdirSync(workspace, { mode: 0o700 });
    prepareServiceMigrationWorkspace(workspace, "seed", "running");
    const unlock = acquireControlWorkspace(workspace);
    try {
        prepareServiceProcessOwnershipSeed(workspace);
        releaseServiceMigrationPending(workspace, "seed");
    } finally {
        unlock();
    }
    fs.writeFileSync(path.join(workspace, "config.yaml"), "{}\n");
    const gateway = fs.readFileSync(path.join(workspace, ".control/gateway.json"));
    const previous: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        workingDirectory: root,
        binPath: path.join(root, "old.js"),
        nodePath: process.execPath,
        host: "127.0.0.1",
        port: 6727,
    };
    const installation = prepareManagerServiceInstallation(previous, host);
    try {
        installation.apply();
    } finally {
        installation.dispose();
    }
    const capture = captureManagerServiceRemoval(previous, host);
    const snapshot = structuredClone(capture.snapshot);
    capture.dispose();
    const files = getServiceFiles("user", host);
    const previousPid = process.pid + 100,
        candidatePid = process.pid + 101;
    const preparation: ManagerServicePreparation = {
        id: "upgrade",
        action: "upgrade",
        desiredEnabled: enabled,
        spec: { ...previous, binPath: path.join(root, "new.js") },
        upgrade: {
            previousSpec: previous,
            previousCandidateDigest: "a".repeat(64),
            candidateDigest: "b".repeat(64),
            snapshot: {
                platform: "linux",
                files: snapshot,
                initial: { enabled, processId: previousPid, identity: "old-invocation" },
            },
        },
    };
    const state: ServicePlatformState = {
        state: "running",
        running: true,
        quiescent: false,
        enabled,
        loaded: true,
        processId: previousPid,
        identity: "old-invocation",
        definitionPath: files.definition,
    };
    const manager: MigrationManagerState = {
        schemaVersion: 1,
        manager: { id: oldId, version: "1.2.3", pid: previousPid },
        gateway: { desired: "running", actual: "running", recoveryRequired: false },
        serviceMigration: { pending: false, recoveryRequired: false },
        knownConfigurationFailure: false,
    };
    const observations: MigrationManagerState[] = [];
    const effects: string[] = [];
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => {
            effects.push("quiesce");
            Object.assign(state, {
                state: "stopped",
                running: false,
                quiescent: true,
                enabled: false,
                processId: null,
            });
        },
        reload: async value => {
            effects.push("reload");
            state.enabled = value;
        },
        start: async () => {
            effects.push("start");
            expect(readManagerUpgradePending(workspace)).toMatchObject({
                operationId: "upgrade",
                candidateDigest: "b".repeat(64),
            });
            Object.assign(state, {
                state: "running",
                running: true,
                quiescent: false,
                processId: candidatePid,
                identity: "new-invocation",
            });
            manager.manager = { id: newId, version: "1.2.4", pid: candidatePid };
            manager.gateway.actual = "stopped";
            manager.serviceMigration.pending = true;
        },
    };
    transport.request.mockImplementation(async (method, route, body) => {
        expect(method).toBe("POST");
        expect(route).toBe("/api/control/service-upgrade/release");
        expect(body).toEqual({
            operationId: "upgrade",
            candidateDigest: "b".repeat(64),
            managerId: newId,
        });
        expect(manager.gateway.actual).toBe("stopped");
        const releaseLock = acquireControlWorkspace(workspace);
        try {
            const marker = readManagerUpgradePending(workspace)!;
            advanceManagerUpgrade(workspace, marker, "releasing", newId);
            manager.gateway.actual = "running";
            manager.gateway.instance = {
                id: "33333333-3333-4333-8333-333333333333",
                pid: candidatePid + 1,
                address: { host: "127.0.0.1", port: 12345 },
            };
            advanceManagerUpgrade(
                workspace,
                readManagerUpgradePending(workspace)!,
                "released",
                newId,
            );
            manager.serviceMigration.pending = false;
        } finally {
            releaseLock();
        }
        if (lostResponse) throw new Error("release response lost");
        return { released: true };
    });
    const journal = new FileManagerServiceJournal(path.join(root, "operations"));
    const port = createManagerServiceUpgradeNativePort(host, {
        platform,
        inspectManager: async () => {
            const observed = structuredClone(manager);
            observations.push(observed);
            return observed;
        },
    });
    return {
        workspace,
        gateway,
        preparation,
        state,
        manager,
        effects,
        observations,
        journal,
        files,
        port,
        host,
        platform,
    };
}
async function completedFixture() {
    const f = fixture(true, true);
    await expect(runManagerServiceUpgrade(f.preparation, f.journal, f.port)).rejects.toThrow();
    const record = f.journal.read("upgrade");
    expect(record).toMatchObject({
        phase: "releasing",
        status: "interrupted",
        recoveryRequired: true,
    });
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({
        phase: "released",
        managerId: newId,
    });
    // 管理进程在完成释放后已重启，仍使用相同不可变候选。
    f.manager.manager.id = "44444444-4444-4444-8444-444444444444";
    f.manager.manager.pid += 10;
    f.state.processId = f.manager.manager.pid;
    f.state.identity = "restarted-invocation";
    vi.mocked(inspectMigrationManager).mockImplementation(async () => structuredClone(f.manager));
    transport.request.mockReset();
    transport.request.mockResolvedValue({
        managerId: f.manager.manager.id,
        candidateDigest: "b".repeat(64),
    });
    f.effects.length = 0;
    return { ...f, record };
}
it("释放响应丢失后允许重启的新实例凭精确候选身份只读对账", async () => {
    const f = await completedFixture();
    const before = fs.readFileSync(path.join(f.workspace, ".control/manager-upgrade-pending.json"));
    await verifyReleasedManagerServiceUpgrade(f.record, f.host, f.platform);
    expect(transport.request).toHaveBeenCalledExactlyOnceWith(
        "GET",
        "/api/control/service-upgrade/identity",
    );
    expect(f.effects).toEqual([]);
    expect(
        fs.readFileSync(path.join(f.workspace, ".control/manager-upgrade-pending.json")),
    ).toEqual(before);
    expect(f.journal.read("upgrade")).toEqual(f.record);
});
it.each(["candidateDigest", "managerId"] as const)(
    "当前身份%s不匹配拒绝，不能重放释放或启动",
    async field => {
        const f = await completedFixture();
        transport.request.mockResolvedValue({
            managerId: f.manager.manager.id,
            candidateDigest: "b".repeat(64),
            [field]: "mismatch",
        });
        await expect(
            verifyReleasedManagerServiceUpgrade(f.record, f.host, f.platform),
        ).rejects.toThrow();
        expect(transport.request).toHaveBeenCalledExactlyOnceWith(
            "GET",
            "/api/control/service-upgrade/identity",
        );
        expect(f.effects).toEqual([]);
        expect(f.journal.read("upgrade")).toEqual(f.record);
    },
);
it("releasing维护标记不能被冷对账补成完成", async () => {
    const f = await completedFixture();
    const file = path.join(f.workspace, ".control/manager-upgrade-pending.json");
    const marker = readManagerUpgradePending(f.workspace)!;
    fs.writeFileSync(file, JSON.stringify({ ...marker, phase: "releasing" }), { mode: 0o600 });
    await expect(
        verifyReleasedManagerServiceUpgrade(f.record, f.host, f.platform),
    ).rejects.toThrow();
    expect(transport.request).not.toHaveBeenCalled();
    expect(f.effects).toEqual([]);
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({ phase: "releasing" });
});

it("OS 无法确认运行实例身份时保留恢复门禁", async () => {
    const f = await completedFixture();
    f.state.identity = null;
    await expect(verifyReleasedManagerServiceUpgrade(f.record, f.host, f.platform)).rejects.toThrow();
    expect(f.effects).toEqual([]);
    expect(f.journal.read("upgrade")).toEqual(f.record);
});
