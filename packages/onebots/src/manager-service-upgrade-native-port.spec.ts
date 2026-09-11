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
import { readManagerUpgradePending } from "./service-upgrade-workspace.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatformState, ServicePlatform } from "./service-platform.js";
vi.mock("./manager-service-upgrade-candidate.js", () => ({ verifyManagerServiceCandidate: vi.fn() }));
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(enabled = true) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-native-upgrade-")); roots.push(root);
    const host: ServiceHost = { platform: "linux", homedir: root, uid: process.getuid?.(), env: {},
        exec: vi.fn(() => { throw new Error("no OS command"); }), spawn: vi.fn(async () => { throw new Error("no spawn"); }) };
    const workspace = path.join(root, "data"); fs.mkdirSync(workspace, { mode: 0o700 });
    prepareServiceMigrationWorkspace(workspace, "seed", "running");
    const unlock = acquireControlWorkspace(workspace);
    try { prepareServiceProcessOwnershipSeed(workspace); releaseServiceMigrationPending(workspace, "seed"); } finally { unlock(); }
    fs.writeFileSync(path.join(workspace, "config.yaml"), "broken: [\r\n");
    const gateway = fs.readFileSync(path.join(workspace, ".control/gateway.json"));
    const previous: ManagerServiceSpec = { schemaVersion: 1, runtimeKind: "control", scope: "user", workspace,
        workingDirectory: root, binPath: path.join(root, "old.js"), nodePath: process.execPath, host: "127.0.0.1", port: 6727 };
    const installation = prepareManagerServiceInstallation(previous, host);
    try { installation.apply(); } finally { installation.dispose(); }
    const capture = captureManagerServiceRemoval(previous, host); const snapshot = structuredClone(capture.snapshot); capture.dispose();
    const files = getServiceFiles("user", host);
    const preparation: ManagerServicePreparation = { id: "upgrade", action: "upgrade", desiredEnabled: enabled,
        spec: { ...previous, binPath: path.join(root, "new.js") }, upgrade: { previousSpec: previous,
            previousCandidateDigest: "a".repeat(64), candidateDigest: "b".repeat(64),
            snapshot: { platform: "linux", files: snapshot, initial: { enabled, processId: null, identity: null } } } };
    const state: ServicePlatformState = { state: "stopped", running: false, quiescent: true, enabled,
        loaded: true, processId: null, identity: null, definitionPath: files.definition };
    const effects: string[] = [];
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => { effects.push("quiesce"); state.enabled = false; },
        reload: async value => { effects.push("reload"); state.enabled = value; },
        start: async () => { effects.push("start"); throw new Error("stopped service must not start"); },
    };
    const journal = new FileManagerServiceJournal(path.join(root, "operations"));
    return { host, workspace, gateway, previous, preparation, state, platform, effects, journal, files };
}
it.each([true, false])("协调器与真实文件/退出证明/离线标记整合，保留 enabled=%s 和停止意图", async enabled => {
    const f = fixture(enabled);
    const port = createManagerServiceUpgradeNativePort(f.host, { platform: f.platform });
    const result = await runManagerServiceUpgrade(f.preparation, f.journal, port);
    expect(result).toMatchObject({ status: "succeeded", phase: "completed" });
    expect(f.effects).toEqual(["quiesce", "reload"]);
    expect(f.state.enabled).toBe(enabled);
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({ phase: "released", completion: "offline" });
    expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(f.preparation.spec);
    expect(fs.readFileSync(path.join(f.workspace, ".control/gateway.json"))).toEqual(f.gateway);
    expect(fs.readFileSync(path.join(f.workspace, "config.yaml"), "utf8")).toBe("broken: [\r\n");
    await expect(runManagerServiceUpgrade(f.preparation, f.journal, port)).rejects.toThrow();
    expect(f.effects).toEqual(["quiesce", "reload"]);
});
it("旧文件变更在第一个OS动作前被拒绝", async () => {
    const f = fixture(); fs.appendFileSync(f.files.definition, "foreign");
    await expect(runManagerServiceUpgrade(f.preparation, f.journal,
        createManagerServiceUpgradeNativePort(f.host, { platform: f.platform }))).rejects.toThrow();
    expect(f.effects).toEqual([]); expect(readManagerUpgradePending(f.workspace)).toBeNull();
});
it("恢复启用状态结果未知时不释放门禁或重复动作", async () => {
    const f = fixture();
    f.platform.reload = async () => { f.effects.push("reload"); throw new Error("unknown"); };
    await expect(runManagerServiceUpgrade(f.preparation, f.journal,
        createManagerServiceUpgradeNativePort(f.host, { platform: f.platform }))).rejects.toThrow();
    expect(f.effects).toEqual(["quiesce", "reload"]);
    expect(readManagerUpgradePending(f.workspace)?.phase).toBeUndefined();
    expect(f.journal.read("upgrade")).toMatchObject({ phase: "restoring-enablement", recoveryRequired: true });
});
it("端口步骤在效果前消费，直接重复调用失败步骤也不能重派", async () => {
    const f = fixture();
    f.platform.quiesce = async () => { f.effects.push("quiesce"); throw new Error("unknown"); };
    const port = createManagerServiceUpgradeNativePort(f.host, { platform: f.platform });
    const record = f.journal.prepare(f.preparation);
    await port.verifyPrepared(record);
    const stopping = { ...record, phase: "stopping" as const };
    await expect(port.quiescePrevious(stopping)).rejects.toThrow();
    await expect(port.quiescePrevious(stopping)).rejects.toThrow();
    await expect(port.prepareMaintenance({ ...record, phase: "writing" })).rejects.toThrow();
    expect(f.effects).toEqual(["quiesce"]);
});
