import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
    ManagerServiceUpgradeRejectedError,
    upgradeManagerService,
    type ManagerServiceUpgradeRequest,
} from "./manager-service-upgrade.js";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import {
    prepareServiceMigrationWorkspace,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import * as workspaceLocks from "./control/workspace.js";
import * as serviceLocks from "./service-migration-lock.js";
import { readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
import type { PersistedOperationObserver } from "./persisted-operation-observer.js";

const candidates = vi.hoisted(() => ({ previous: "", target: "", previousDigest: "a".repeat(64) }));
vi.mock("./manager-runtime/identity.js", () => ({
    readRunningManagerCandidate: vi.fn(() => ({ directory: candidates.previous })),
    managerCandidateDigest: vi.fn(() => candidates.previousDigest),
}));
vi.mock("./manager-runtime/reader.js", () => ({
    readVerifiedManagerCandidate: vi.fn(() => ({ directory: candidates.target })),
}));
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(enabled = true) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-upgrade-entry-"));
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
    const release = acquireControlWorkspace(workspace);
    try {
        prepareServiceProcessOwnershipSeed(workspace);
        releaseServiceMigrationPending(workspace, "seed");
    } finally {
        release();
    }
    fs.writeFileSync(path.join(workspace, "config.yaml"), "broken: [\r\n");
    const gateway = fs.readFileSync(path.join(workspace, ".control/gateway.json"));
    const homes = [path.join(root, "old-artifacts"), path.join(root, "new-artifacts")];
    for (const home of homes) {
        fs.mkdirSync(home, { mode: 0o700 });
        acquireControlWorkspace(home)();
    }
    candidates.previous = path.join(homes[0], "versions", "11111111-1111-4111-8111-111111111111");
    candidates.target = path.join(homes[1], "versions", "22222222-2222-4222-8222-222222222222");
    candidates.previousDigest = "a".repeat(64);
    for (const directory of [candidates.previous, candidates.target])
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const previous: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        workingDirectory: candidates.previous,
        binPath: path.join(candidates.previous, "node_modules/onebots/lib/bin.js"),
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
    const files = getServiceFiles("user", host);
    const state: ServicePlatformState = {
        state: "stopped",
        running: false,
        quiescent: true,
        enabled,
        loaded: true,
        processId: null,
        identity: null,
        definitionPath: files.definition,
    };
    const effects: string[] = [];
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => {
            effects.push("quiesce");
            state.enabled = false;
        },
        reload: async value => {
            effects.push("reload");
            state.enabled = value;
        },
        start: async () => {
            effects.push("start");
            throw new Error("must not start");
        },
    };
    const request: ManagerServiceUpgradeRequest = {
        id: "upgrade",
        scope: "user",
        candidateDirectory: candidates.target,
        candidateDigest: "b".repeat(64),
    };
    const run = (onOperation?: PersistedOperationObserver) =>
        upgradeManagerService(request, host, { platform, ...(onOperation ? { onOperation } : {}) });
    const journal = () =>
        new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
    return {
        host,
        workspace,
        gateway,
        homes,
        previous,
        files,
        state,
        effects,
        request,
        run,
        journal,
        platform,
    };
}
it.each([true, false])("外部入口完成停止服务升级并保持 enabled=%s，不启动网关", async enabled => {
    const f = fixture(enabled);
    const operations: Parameters<PersistedOperationObserver>[0][] = [];
    const result = await f.run(operation => operations.push(operation));
    expect(result).toMatchObject({
        status: "succeeded",
        phase: "completed",
        recoveryRequired: false,
    });
    expect(f.effects).toEqual(["quiesce", "reload"]);
    expect(f.state).toMatchObject({ enabled, running: false });
    expect(f.journal().read("upgrade")).toMatchObject({ status: "succeeded", phase: "completed" });
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({
        phase: "released",
        completion: "offline",
    });
    expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toMatchObject({
        workingDirectory: candidates.target,
    });
    expect(fs.readFileSync(path.join(f.workspace, "config.yaml"), "utf8")).toBe("broken: [\r\n");
    expect(fs.readFileSync(path.join(f.workspace, ".control/gateway.json"))).toEqual(f.gateway);
    expect(operations.at(-1)).toEqual({
        id: "upgrade",
        action: "manager-service.upgrade",
        status: "succeeded",
        phase: "completed",
    });
    expect(JSON.stringify(operations)).not.toContain(f.workspace);
    for (const home of f.homes) acquireControlWorkspace(home)();
    acquireServiceMigrationLock(f.files.stateDir)();
});
it.each(["service", "previous", "target"])(
    "%s 锁已占用时不派发系统动作，释放后可以升级",
    async lock => {
        const f = fixture();
        const release =
            lock === "service"
                ? acquireServiceMigrationLock(f.files.stateDir)
                : acquireControlWorkspace(f.homes[lock === "previous" ? 0 : 1]);
        try {
            if (lock === "service")
                await expect(f.run()).rejects.toBeInstanceOf(ManagerServiceUpgradeRejectedError);
            else await expect(f.run()).rejects.toThrow();
            expect(f.effects).toEqual([]);
            expect(readManagerUpgradePending(f.workspace)).toBeNull();
        } finally {
            release();
        }
        await expect(f.run()).resolves.toMatchObject({ status: "succeeded" });
    },
);
it("存在未完成服务操作时拒绝升级且不修改服务文件", async () => {
    const f = fixture();
    f.journal().prepare({ id: "pending", action: "stop", spec: f.previous, desiredEnabled: true });
    const definition = fs.readFileSync(f.files.definition);
    await expect(f.run()).rejects.toBeInstanceOf(ManagerServiceUpgradeRejectedError);
    expect(f.effects).toEqual([]);
    expect(fs.readFileSync(f.files.definition)).toEqual(definition);
    expect(readManagerUpgradePending(f.workspace)).toBeNull();
});
it("相同候选摘要拒绝升级且释放所有锁", async () => {
    const f = fixture();
    candidates.previousDigest = f.request.candidateDigest;
    await expect(f.run()).rejects.toThrow();
    expect(f.effects).toEqual([]);
    expect(readManagerUpgradePending(f.workspace)).toBeNull();
    for (const home of f.homes) acquireControlWorkspace(home)();
    acquireServiceMigrationLock(f.files.stateDir)();
});

it("活动管理版本在候选准备后变化时按摘要CAS拒绝，且不派发系统动作", async () => {
    const f = fixture();
    f.request.expectedPreviousDigest = "c".repeat(64);
    await expect(f.run()).rejects.toBeInstanceOf(ManagerServiceUpgradeRejectedError);
    expect(f.effects).toEqual([]);
    expect(readManagerUpgradePending(f.workspace)).toBeNull();
    for (const home of f.homes) acquireControlWorkspace(home)();
    acquireServiceMigrationLock(f.files.stateDir)();
});

it("停止结果未知时持久记录中断，释放所有锁且拒绝再次派发", async () => {
    const f = fixture();
    f.platform.quiesce = async () => {
        f.effects.push("quiesce");
        throw new Error("lost OS acknowledgement");
    };
    await expect(f.run()).rejects.toThrow();
    expect(f.journal().read("upgrade")).toMatchObject({
        phase: "stopping",
        status: "interrupted",
        recoveryRequired: true,
    });
    for (const home of f.homes) acquireControlWorkspace(home)();
    acquireServiceMigrationLock(f.files.stateDir)();
    await expect(f.run()).rejects.toThrow();
    expect(f.effects).toEqual(["quiesce"]);
});

it.each([false, true])("释放错误不遗漏锁，并保持事务失败=%s 的语义", async transactionFails => {
    const f = fixture();
    const realArtifactLock = workspaceLocks.acquireControlWorkspace;
    const realServiceLock = serviceLocks.acquireServiceMigrationLock;
    const released: string[] = [];
    vi.spyOn(workspaceLocks, "acquireControlWorkspace").mockImplementation(root => {
        const release = realArtifactLock(root);
        if (!f.homes.includes(root)) return release;
        return () => {
            release();
            released.push(root);
            throw new Error("private artifact database path and secret");
        };
    });
    vi.spyOn(serviceLocks, "acquireServiceMigrationLock").mockImplementation(root => {
        const release = realServiceLock(root);
        return () => {
            release();
            released.push("service");
            throw new Error("private service database path and secret");
        };
    });
    if (transactionFails)
        f.platform.quiesce = async () => {
            f.effects.push("quiesce");
            throw new Error("private OS error");
        };
    await expect(f.run()).rejects.toThrow(
        transactionFails
            ? "管理服务升级尚未确认，已停止派发；请对账原操作，禁止重试安装或自动回滚"
            : "管理服务升级已完成，但锁释放未确认；请核对原操作结果，禁止重复升级",
    );
    expect(released).toEqual([...f.homes].sort().reverse().concat("service"));
    expect(f.journal().read("upgrade")).toMatchObject(
        transactionFails
            ? { phase: "stopping", status: "interrupted", recoveryRequired: true }
            : { phase: "completed", status: "succeeded", recoveryRequired: false },
    );
    // 用真实 SQLite 再次取得所有锁，证明不是仅调用了 mock 回调。
    for (const home of f.homes) realArtifactLock(home)();
    realServiceLock(f.files.stateDir)();
});
