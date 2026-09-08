import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { upgradeManagerService } from "./manager-service-upgrade.js";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { prepareServiceMigrationWorkspace, releaseServiceMigrationPending } from "./service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";

const candidates = vi.hoisted(() => ({ previous: "", target: "", previousDigest: "a".repeat(64) }));
vi.mock("./manager-runtime/identity.js", () => ({
    readRunningManagerCandidate: vi.fn(() => ({ directory: candidates.previous })),
    managerCandidateDigest: vi.fn(() => candidates.previousDigest),
}));
vi.mock("./manager-runtime/reader.js", () => ({
    readVerifiedManagerCandidate: vi.fn(() => ({ directory: candidates.target })),
}));
vi.mock("./manager-service-upgrade-candidate.js", () => ({ verifyManagerServiceCandidate: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(enabled = true) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-upgrade-entry-")); roots.push(root);
    const host: ServiceHost = { platform: "linux", homedir: root, uid: process.getuid?.(), env: {},
        exec: vi.fn(() => { throw new Error("no OS command"); }),
        spawn: vi.fn(async () => { throw new Error("no spawn"); }) };
    const workspace = path.join(root, "data"); fs.mkdirSync(workspace, { mode: 0o700 });
    prepareServiceMigrationWorkspace(workspace, "seed", "running");
    const release = acquireControlWorkspace(workspace);
    try { prepareServiceProcessOwnershipSeed(workspace); releaseServiceMigrationPending(workspace, "seed"); }
    finally { release(); }
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
    for (const directory of [candidates.previous, candidates.target]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const previous: ManagerServiceSpec = { schemaVersion: 1, runtimeKind: "control", scope: "user", workspace,
        workingDirectory: candidates.previous, binPath: path.join(candidates.previous, "node_modules/onebots/lib/bin.js"),
        nodePath: process.execPath, host: "127.0.0.1", port: 6727 };
    const installation = prepareManagerServiceInstallation(previous, host);
    try { installation.apply(); } finally { installation.dispose(); }
    const files = getServiceFiles("user", host);
    const state: ServicePlatformState = { state: "stopped", running: false, quiescent: true, enabled,
        loaded: true, processId: null, identity: null, definitionPath: files.definition };
    const effects: string[] = [];
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => { effects.push("quiesce"); state.enabled = false; },
        reload: async value => { effects.push("reload"); state.enabled = value; },
        start: async () => { effects.push("start"); throw new Error("must not start"); },
    };
    const request = { id: "upgrade", scope: "user" as const, candidateDirectory: candidates.target, candidateDigest: "b".repeat(64) };
    const run = () => upgradeManagerService(request, host, { platform });
    const journal = () => new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
    return { host, workspace, gateway, homes, previous, files, state, effects, request, run, journal, platform };
}
it.each([true, false])("外部入口完成停止服务升级并保持 enabled=%s，不启动网关", async enabled => {
    const f = fixture(enabled);
    const result = await f.run();
    expect(result).toMatchObject({ status: "succeeded", phase: "completed", recoveryRequired: false });
    expect(f.effects).toEqual(["quiesce", "reload"]);
    expect(f.state).toMatchObject({ enabled, running: false });
    expect(f.journal().read("upgrade")).toMatchObject({ status: "succeeded", phase: "completed" });
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({ phase: "released", completion: "offline" });
    expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toMatchObject({ workingDirectory: candidates.target });
    expect(fs.readFileSync(path.join(f.workspace, "config.yaml"), "utf8")).toBe("broken: [\r\n");
    expect(fs.readFileSync(path.join(f.workspace, ".control/gateway.json"))).toEqual(f.gateway);
    for (const home of f.homes) acquireControlWorkspace(home)();
    acquireServiceMigrationLock(f.files.stateDir)();
});
it.each(["service", "previous", "target"])("%s 锁已占用时不派发系统动作，释放后可以升级", async lock => {
    const f = fixture();
    const release = lock === "service" ? acquireServiceMigrationLock(f.files.stateDir)
        : acquireControlWorkspace(f.homes[lock === "previous" ? 0 : 1]);
    try {
        await expect(f.run()).rejects.toThrow();
        expect(f.effects).toEqual([]);
        expect(readManagerUpgradePending(f.workspace)).toBeNull();
    } finally { release(); }
    await expect(f.run()).resolves.toMatchObject({ status: "succeeded" });
});
it("存在未完成服务操作时拒绝升级且不修改服务文件", async () => {
    const f = fixture();
    f.journal().prepare({ id: "pending", action: "stop", spec: f.previous, desiredEnabled: true });
    const definition = fs.readFileSync(f.files.definition);
    await expect(f.run()).rejects.toThrow();
    expect(f.effects).toEqual([]);
    expect(fs.readFileSync(f.files.definition)).toEqual(definition);
    expect(readManagerUpgradePending(f.workspace)).toBeNull();
});
it("相同候选摘要拒绝升级且释放所有锁", async () => {
    const f = fixture(); candidates.previousDigest = f.request.candidateDigest;
    await expect(f.run()).rejects.toThrow();
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
    expect(f.journal().read("upgrade")).toMatchObject({ phase: "stopping", status: "interrupted", recoveryRequired: true });
    for (const home of f.homes) acquireControlWorkspace(home)();
    acquireServiceMigrationLock(f.files.stateDir)();
    await expect(f.run()).rejects.toThrow();
    expect(f.effects).toEqual(["quiesce"]);
});
