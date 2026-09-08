import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { releaseStoppedManagerServiceUpgrade } from "./manager-service-upgrade-offline.js";
import { prepareManagerUpgradeWorkspace, readManagerUpgradePending, managerUpgradeStatus, readManagerUpgradeHistory } from "./service-upgrade-workspace.js";
import { prepareServiceMigrationWorkspace, releaseServiceMigrationPending } from "./service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
const identity = vi.hoisted(() => ({ directory: "", valid: true }));
vi.mock("./manager-runtime/identity.js", () => ({
    readRunningManagerCandidate: () => ({ directory: identity.directory, management: { checks: { authenticationV2: identity.valid } } }),
    managerCandidateDigest: () => "b".repeat(64),
}));
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); identity.valid = true; for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-offline-")); roots.push(root);
    const host: ServiceHost = { platform: "linux", homedir: root, uid: process.getuid?.(), env: {},
        exec: vi.fn(() => { throw new Error("no OS effects"); }), spawn: vi.fn(async () => { throw new Error("no spawn"); }) };
    const workspace = path.join(root, "data");
    fs.mkdirSync(workspace, { mode: 0o700 });
    prepareServiceMigrationWorkspace(workspace, "seed", "running");
    const unlock = acquireControlWorkspace(workspace);
    try { prepareServiceProcessOwnershipSeed(workspace); releaseServiceMigrationPending(workspace, "seed"); } finally { unlock(); }
    fs.writeFileSync(path.join(workspace, "config.yaml"), "broken: [\r\n");
    const gateway = fs.readFileSync(path.join(workspace, ".control/gateway.json"));
    await prepareManagerUpgradeWorkspace(workspace, { schemaVersion: 1, operationId: "upgrade", candidateDigest: "b".repeat(64) });
    identity.directory = path.join(root, "candidate");
    const binPath = path.join(identity.directory, "node_modules/onebots/lib/bin.js");
    fs.mkdirSync(path.dirname(binPath), { recursive: true }); fs.writeFileSync(binPath, "");
    const spec: ManagerServiceSpec = { schemaVersion: 1, runtimeKind: "control", scope: "user", workspace,
        workingDirectory: identity.directory, nodePath: process.execPath, binPath, host: "127.0.0.1", port: 6727 };
    const install = prepareManagerServiceInstallation(spec, host);
    try { install.apply(); } finally { install.dispose(); }
    const files = getServiceFiles("user", host);
    const capture = captureManagerServiceRemoval(spec, host); const snapshot = structuredClone(capture.snapshot); capture.dispose();
    const journal = new FileManagerServiceJournal(path.join(root, "journal"));
    let record = journal.prepare({ id: "upgrade", action: "upgrade", desiredEnabled: true, spec,
        upgrade: { previousSpec: { ...spec, binPath: path.join(root, "old.js") },
            previousCandidateDigest: "a".repeat(64), candidateDigest: "b".repeat(64),
            snapshot: { platform: "linux", files: snapshot, initial: { enabled: true, processId: null, identity: null } } } });
    for (const phase of ["stopping", "writing", "restoring-enablement", "verifying", "releasing"] as const) {
        record = { ...record, phase }; journal.save(record);
    }
    const state: ServicePlatformState = { state: "stopped", running: false, enabled: true, loaded: true,
        definitionPath: files.definition, processId: null, identity: null, quiescent: true };
    const platform: ServicePlatform = { inspect: vi.fn(async () => structuredClone(state)),
        quiesce: vi.fn(), reload: vi.fn(), start: vi.fn() };
    return { workspace, record, host, platform, state, gateway, files };
}
it("离线确认不启动任何进程，不改变原网关运行意图，重复确认只读", async () => {
    const f = await fixture();
    await releaseStoppedManagerServiceUpgrade(f.record, f.host, f.platform);
    expect(readManagerUpgradePending(f.workspace)).toMatchObject({ phase: "released", completion: "offline" });
    expect(managerUpgradeStatus(f.workspace)).toEqual({ pending: false, recoveryRequired: false });
    const marker = fs.readFileSync(path.join(f.workspace, ".control/manager-upgrade-pending.json"));
    await releaseStoppedManagerServiceUpgrade(f.record, f.host, f.platform);
    expect(fs.readFileSync(path.join(f.workspace, ".control/manager-upgrade-pending.json"))).toEqual(marker);
    expect(fs.readFileSync(path.join(f.workspace, ".control/gateway.json"))).toEqual(f.gateway);
    expect(fs.readFileSync(path.join(f.workspace, "config.yaml"), "utf8")).toBe("broken: [\r\n");
    expect(f.platform.start).not.toHaveBeenCalled(); expect(f.platform.reload).not.toHaveBeenCalled();
    expect(f.host.exec).not.toHaveBeenCalled(); expect(f.host.spawn).not.toHaveBeenCalled();
});
it.each(["process", "format", "definition", "marker"])("拒绝 %s 不确定证据，保留维护状态", async problem => {
    const f = await fixture();
    if (problem === "process") f.state.processId = process.pid;
    if (problem === "format") identity.valid = false;
    if (problem === "definition") fs.appendFileSync(f.files.definition, "foreign");
    if (problem === "marker") fs.writeFileSync(path.join(f.workspace, ".control/manager-upgrade-pending.json"), JSON.stringify({ schemaVersion: 1, operationId: "other", candidateDigest: "b".repeat(64) }));
    await expect(releaseStoppedManagerServiceUpgrade(f.record, f.host, f.platform)).rejects.toThrow();
    expect(managerUpgradeStatus(f.workspace).pending).toBe(true);
    expect(f.platform.start).not.toHaveBeenCalled();
});

it("停止服务可保留 OS 历史实例标识，离线完成可归档进入下一次升级", async () => {
    const f = await fixture();
    f.state.identity = "retained-invocation-id";
    await releaseStoppedManagerServiceUpgrade(f.record, f.host, f.platform);
    await prepareManagerUpgradeWorkspace(f.workspace, {
        schemaVersion: 1, operationId: "next", candidateDigest: "c".repeat(64),
    });
    expect(readManagerUpgradeHistory(f.workspace, "upgrade")).toMatchObject({ phase: "released", completion: "offline" });
    expect(readManagerUpgradePending(f.workspace)?.operationId).toBe("next");
});
it("完成回执已写但结果未知时，可只读对账，不重复写入或启动", async () => {
    const f = await fixture();
    const original = ConfigurationFile.prototype.replaceRaw;
    const write = vi.spyOn(ConfigurationFile.prototype, "replaceRaw").mockImplementation(function (revision, bytes) {
        original.call(this, revision, bytes);
        throw new Error("lost acknowledgement");
    });
    await expect(releaseStoppedManagerServiceUpgrade(f.record, f.host, f.platform)).rejects.toThrow();
    expect(readManagerUpgradePending(f.workspace)?.completion).toBe("offline");
    await releaseStoppedManagerServiceUpgrade(f.record, f.host, f.platform);
    expect(write).toHaveBeenCalledTimes(1);
    expect(f.platform.start).not.toHaveBeenCalled();
});
it("在线释放中断不能通过离线入口绕过恢复", async () => {
    const f = await fixture();
    const marker = path.join(f.workspace, ".control/manager-upgrade-pending.json");
    const bytes = JSON.stringify({ schemaVersion: 1, operationId: "upgrade", candidateDigest: "b".repeat(64),
        phase: "releasing", managerId: "12345678-1234-1234-1234-123456789012" });
    fs.writeFileSync(marker, bytes);
    await expect(releaseStoppedManagerServiceUpgrade(f.record, f.host, f.platform)).rejects.toThrow();
    expect(fs.readFileSync(marker, "utf8")).toBe(bytes);
});
