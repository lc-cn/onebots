import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reconcileManagerServiceOperation } from "./manager-service-recovery.js";
import { FileManagerServiceJournal, type ManagerServiceAction } from "./manager-service-journal.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { getServiceFiles } from "./service-files.js";
import {
    prepareServiceMigrationWorkspace,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("reconciles an existing readable project workspace without changing its permissions", async () => {
    const f = fixture();
    fs.chmodSync(f.workspace, 0o755);
    const result = await reconcileManagerServiceOperation("operation", "user", f.host, {
        platform: f.platform,
    });
    expect(result.status).toBe("succeeded");
    expect(fs.statSync(f.workspace).mode & 0o777).toBe(0o755);
});
function fixture(action: ManagerServiceAction = "stop") {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/manager-reconcile-"));
    roots.push(root);
    const effects: string[] = [];
    const presence = { absent: action === "uninstall" };
    const host: ServiceHost = {
        platform: "linux",
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec(file, args) {
            if (file === "systemctl" && args.includes("show")) {
                if (!presence.absent) throw new Error("service still loaded");
                return "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\nFragmentPath=\n";
            }
            effects.push("exec");
            throw new Error("must not mutate OS");
        },
        spawn: async () => {
            effects.push("spawn");
            throw new Error("must not spawn");
        },
    };
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { mode: 0o700 });
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        workingDirectory: root,
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        host: "127.0.0.1",
        port: 6727,
    };
    const files = getServiceFiles("user", host);
    fs.mkdirSync(path.dirname(files.definition), { recursive: true, mode: 0o700 });
    fs.mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
        files.definition,
        renderInstalledManagerService(spec, host.platform, files.stateDir),
        { mode: 0o644 },
    );
    fs.writeFileSync(files.metadata, JSON.stringify(spec), { mode: 0o600 });
    prepareServiceMigrationWorkspace(workspace, "seed", "stopped");
    const unlock = acquireControlWorkspace(workspace);
    try {
        prepareServiceProcessOwnershipSeed(workspace);
        releaseServiceMigrationPending(workspace, "seed");
    } finally {
        unlock();
    }
    fs.writeFileSync(path.join(workspace, "config.yaml"), "synthetic-secret: [\r\n", {
        mode: 0o600,
    });
    fs.writeFileSync(path.join(workspace, ".control/auth.json"), "synthetic-auth", { mode: 0o600 });
    const saved = [
        "config.yaml",
        ".control/auth.json",
        ".control/gateway.json",
        ".control/process-ownership.json",
    ].map(file => ({
        file: path.join(workspace, file),
        bytes: fs.readFileSync(path.join(workspace, file)),
    }));
    const journal = new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
    const capture = ["uninstall", "upgrade"].includes(action)
        ? captureManagerServiceRemoval(spec, host)
        : undefined;
    const record = journal.prepare({
        id: "operation",
        action,
        spec,
        desiredEnabled: action !== "uninstall",
        ...(capture && action === "uninstall"
            ? {
                  removal: {
                      platform: "linux" as const,
                      files: capture.snapshot,
                      initial: { enabled: true, processId: null, identity: null },
                  },
              }
            : {}),
        ...(capture && action === "upgrade"
            ? {
                  upgrade: {
                      previousSpec: { ...spec, binPath: "/app/old-bin.js" },
                      previousCandidateDigest: "a".repeat(64),
                      candidateDigest: "b".repeat(64),
                      snapshot: {
                          platform: "linux" as const,
                          files: capture.snapshot,
                          initial: { enabled: true, processId: null, identity: null },
                      },
                  },
              }
            : {}),
    });
    capture?.dispose();
    if (action === "uninstall") {
        fs.unlinkSync(files.definition);
        fs.unlinkSync(files.metadata);
    }
    journal.save({ ...record, status: "interrupted", recoveryRequired: true });
    const state: ServicePlatformState = {
        state: "stopped",
        running: false,
        loaded: action !== "uninstall",
        enabled: action !== "uninstall",
        definitionPath: files.definition,
        processId: null,
        identity: null,
        quiescent: true,
    };
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => {
            effects.push("quiesce");
            throw new Error("must not stop");
        },
        reload: async () => {
            effects.push("reload");
            throw new Error("must not reload");
        },
        start: async () => {
            effects.push("start");
            throw new Error("must not start");
        },
    };
    return {
        root,
        host,
        files,
        workspace,
        journal,
        record,
        saved,
        state,
        platform,
        effects,
        presence,
        inspectManager: async () => ({
            schemaVersion: 1 as const,
            manager: {
                id: "10000000-0000-4000-8000-000000000001",
                pid: state.processId!,
                version: "1.0.0",
            },
            gateway: {
                desired: "running" as const,
                actual: "running" as const,
                recoveryRequired: false,
            },
            serviceMigration: { pending: false, recoveryRequired: false },
            knownConfigurationFailure: false,
        }),
    };
}
describe("manager service explicit target-state reconciliation", () => {
    it("reconciles an achieved start by matching stable OS and live manager identity", async () => {
        const f = fixture("start");
        Object.assign(f.state, {
            state: "running",
            running: true,
            loaded: true,
            processId: 321,
            identity: "manager-instance",
            quiescent: false,
        });
        const result = await reconcileManagerServiceOperation("operation", "user", f.host, {
            platform: f.platform,
            inspectManager: f.inspectManager,
        });
        expect(result).toMatchObject({
            action: "start",
            status: "succeeded",
            phase: "completed",
            recoveryRequired: false,
        });
        expect(f.effects).toEqual([]);
    });
    it("keeps start blocked when the live manager PID does not match launchd", async () => {
        const f = fixture("start");
        Object.assign(f.state, {
            state: "running",
            running: true,
            loaded: true,
            processId: 321,
            identity: "manager-instance",
            quiescent: false,
        });
        const before = f.journal.read("operation");
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, {
                platform: f.platform,
                inspectManager: async () => ({
                    ...(await f.inspectManager()),
                    manager: { ...(await f.inspectManager()).manager, pid: 999 },
                }),
            }),
        ).rejects.toThrow();
        expect(f.journal.read("operation")).toEqual(before);
        expect(f.effects).toEqual([]);
    });
    it("升级操作不能通过普通停止对账误标完成，保留文件及恢复门禁", async () => {
        const f = fixture("upgrade");
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, {
                platform: f.platform,
            }),
        ).rejects.toThrow("未重放系统动作");
        expect(f.effects).toEqual([]);
        expect(f.journal.read("operation").recoveryRequired).toBe(true);
        for (const saved of f.saved) expect(fs.readFileSync(saved.file)).toEqual(saved.bytes);
    });
    it("rechecks the target instead of trusting a completed operation on repeat", async () => {
        const f = fixture();
        await reconcileManagerServiceOperation("operation", "user", f.host, {
            platform: f.platform,
        });
        f.state.running = true;
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, { platform: f.platform }),
        ).rejects.toThrow();
        expect(f.effects).toEqual([]);
    });
    it("rejects uninstall snapshot paths that do not belong to this service", async () => {
        const f = fixture("uninstall");
        const record = f.journal.read("operation");
        record.removal!.files.metadata.path = path.join(f.root, "unrelated.json");
        fs.writeFileSync(
            path.join(f.files.stateDir, "manager-operations/operation.json"),
            JSON.stringify(record),
        );
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, { platform: f.platform }),
        ).rejects.toThrow();
        expect(f.journal.read("operation").recoveryRequired).toBe(true);
        expect(f.effects).toEqual([]);
    });
    it("refuses changed stop metadata without rewriting it", async () => {
        const f = fixture();
        const changed = JSON.stringify({ ...f.record.managerSpec, port: 7777 });
        fs.writeFileSync(f.files.metadata, changed);
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, { platform: f.platform }),
        ).rejects.toThrow();
        expect(fs.readFileSync(f.files.metadata, "utf8")).toBe(changed);
        expect(f.effects).toEqual([]);
    });
    it.each(["stop", "uninstall"] as const)(
        "completes %s with real process proof and same-id revalidation only",
        async action => {
            const f = fixture(action);
            for (let attempt = 0; attempt < 2; attempt++) {
                const result = await reconcileManagerServiceOperation("operation", "user", f.host, {
                    platform: f.platform,
                });
                expect(result).toMatchObject({
                    id: "operation",
                    action,
                    status: "succeeded",
                    phase: "completed",
                    recoveryRequired: false,
                });
                expect(f.journal.read("operation")).toEqual(result);
                expect(f.effects).toEqual([]);
                for (const saved of f.saved)
                    expect(fs.readFileSync(saved.file)).toEqual(saved.bytes);
            }
        },
    );
    it.each(["running", "enabled", "quiescent"] as const)(
        "rejects stop target mismatch %s without changing journal",
        async field => {
            const f = fixture();
            const before = f.journal.read("operation");
            f.state[field] = field === "running";
            await expect(
                reconcileManagerServiceOperation("operation", "user", f.host, {
                    platform: f.platform,
                }),
            ).rejects.toThrow();
            expect(f.journal.read("operation")).toEqual(before);
            expect(f.effects).toEqual([]);
        },
    );
    it("holds the workspace lock throughout process proof and rejects false proof", async () => {
        const f = fixture();
        const before = f.journal.read("operation");
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, {
                platform: f.platform,
                confirmStopped: async workspace => {
                    expect(workspace).toBe(f.workspace);
                    expect(() => acquireControlWorkspace(workspace)).toThrow();
                    return false;
                },
            }),
        ).rejects.toThrow();
        expect(f.journal.read("operation")).toEqual(before);
        expect(f.effects).toEqual([]);
    });
    it("rejects OS changes across process proof", async () => {
        const f = fixture();
        let observations = 0;
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, {
                platform: f.platform,
                confirmStopped: async () => {
                    if (++observations === 2) f.state.identity = "unexpected-instance";
                    return true;
                },
            }),
        ).rejects.toThrow();
        expect(f.journal.read("operation").recoveryRequired).toBe(true);
        expect(f.effects).toEqual([]);
    });
    it.each(["definition", "metadata"] as const)(
        "never removes a recreated uninstall %s",
        async key => {
            const f = fixture("uninstall");
            fs.writeFileSync(f.files[key], "external", { mode: 0o600 });
            await expect(
                reconcileManagerServiceOperation("operation", "user", f.host, {
                    platform: f.platform,
                }),
            ).rejects.toThrow();
            expect(fs.readFileSync(f.files[key], "utf8")).toBe("external");
            expect(f.effects).toEqual([]);
        },
    );
    it("rejects uninstall while OS identity remains present", async () => {
        const f = fixture("uninstall");
        f.presence.absent = false;
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, { platform: f.platform }),
        ).rejects.toThrow();
        expect(f.journal.read("operation").recoveryRequired).toBe(true);
        expect(f.effects).toEqual([]);
    });
    it.each(["restart", "install"] as const)(
        "does not claim recovery for unsupported %s",
        async action => {
            const f = fixture(action);
            await expect(
                reconcileManagerServiceOperation("operation", "user", f.host, {
                    platform: f.platform,
                }),
            ).rejects.toThrow();
            expect(f.journal.read("operation").recoveryRequired).toBe(true);
            expect(f.effects).toEqual([]);
        },
    );
    it("refuses an unrelated unfinished operation and migration marker", async () => {
        const f = fixture();
        const recordFile = path.join(f.files.stateDir, "manager-operations/foreign.json");
        fs.writeFileSync(
            recordFile,
            JSON.stringify({ ...f.journal.read("operation"), id: "foreign" }),
            { mode: 0o600 },
        );
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, { platform: f.platform }),
        ).rejects.toThrow();
        fs.unlinkSync(recordFile);
        fs.writeFileSync(path.join(f.workspace, ".control/migration-pending.json"), "{}", {
            mode: 0o600,
        });
        await expect(
            reconcileManagerServiceOperation("operation", "user", f.host, { platform: f.platform }),
        ).rejects.toThrow();
        expect(f.effects).toEqual([]);
    });
});

it("普通stop对账不能跨过尚未完成的升级确认", async () => {
    const f = fixture();
    fs.writeFileSync(
        path.join(f.workspace, ".control/manager-upgrade-pending.json"),
        JSON.stringify({
            schemaVersion: 1,
            operationId: "upgrade",
            candidateDigest: "a".repeat(64),
            phase: "releasing",
            managerId: "10000000-0000-4000-8000-000000000001",
        }),
        { mode: 0o600 },
    );
    await expect(
        reconcileManagerServiceOperation("operation", "user", f.host, { platform: f.platform }),
    ).rejects.toThrow();
    expect(f.effects).toEqual([]);
});
