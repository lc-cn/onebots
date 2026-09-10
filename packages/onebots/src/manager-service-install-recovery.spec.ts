import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const proof = vi.hoisted(() => ({ acl: "a".repeat(64), candidate: undefined as unknown }));
vi.mock("./windows-service-security.js", () => ({
    inspectWindowsServiceDirectorySecurity: vi.fn(() => proof.acl),
    inspectWindowsServiceFileSecurity: vi.fn(() => proof.acl),
    secureWindowsServiceDirectory: vi.fn(() => proof.acl),
    secureWindowsServiceFile: vi.fn(() => proof.acl),
}));
vi.mock("./manager-runtime/reader.js", () => ({
    readVerifiedManagerCandidate: vi.fn(() => proof.candidate),
}));
vi.mock("./manager-runtime/identity.js", () => ({
    managerCandidateDigest: vi.fn(() => "b".repeat(64)),
    readRunningManagerCandidate: vi.fn(),
}));
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: vi.fn(() => proof.candidate),
}));

import { captureInstalledManagerCandidate } from "./manager-service-install-recovery.js";
import { reconcileManagerServiceOperation } from "./manager-service-recovery.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { getServiceFiles } from "./service-files.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import {
    prepareServiceMigrationWorkspace,
    readServiceMigrationPending,
} from "./service-migration-workspace.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatformState } from "./service-platform.js";

const roots: string[] = [];
afterEach(() => {
    proof.acl = "a".repeat(64);
    vi.clearAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "onebots-win-recover-")));
    roots.push(root);
    const host: ServiceHost = {
        platform: "win32",
        homedir: root,
        isElevated: true,
        windowsSid: "S-1-5-21-100-200-300-1001",
        env: { ProgramData: root },
        exec: vi.fn(() => ""),
        spawn: vi.fn(async () => 0),
    };
    const files = getServiceFiles("system", host);
    const workspace = path.join(root, "workspace");
    const home = path.join(files.stateDir, "manager-artifacts");
    const candidateDirectory = path.join(home, "versions", "candidate");
    const binding = path.join(home, "bootstrap");
    for (const directory of [
        files.stateDir,
        home,
        path.join(home, ".control"),
        path.join(home, "versions"),
        candidateDirectory,
        binding,
        workspace,
    ])
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const spec = {
        schemaVersion: 1 as const,
        runtimeKind: "control" as const,
        scope: "system" as const,
        workspace,
        workingDirectory: candidateDirectory,
        nodePath: process.execPath,
        binPath: path.join(candidateDirectory, "node_modules/onebots/lib/bin.js"),
        host: "127.0.0.1",
        port: 6727,
    };
    const planDigest = "c".repeat(64);
    proof.candidate = {
        id: "candidate",
        operationId: "operation",
        planDigest,
        directory: candidateDirectory,
    };
    fs.writeFileSync(
        path.join(binding, "intent.json"),
        JSON.stringify({
            schemaVersion: 1,
            id: "operation",
            service: { ...spec, workingDirectory: process.cwd(), binPath: process.execPath },
            planDigest,
        }),
        { mode: 0o600 },
    );
    fs.writeFileSync(
        path.join(binding, "candidate.json"),
        JSON.stringify({
            schemaVersion: 1,
            id: "operation",
            planDigest,
            candidateId: "candidate",
            candidateDigest: "b".repeat(64),
            spec,
        }),
        { mode: 0o600 },
    );
    fs.writeFileSync(
        files.definition,
        renderInstalledManagerService(spec, "win32", files.stateDir),
        { mode: 0o644 },
    );
    fs.writeFileSync(files.metadata, JSON.stringify(spec), { mode: 0o600 });
    prepareServiceMigrationWorkspace(workspace, "operation", "running");
    const journal = new FileManagerServiceJournal(path.join(files.stateDir, "manager-operations"));
    const initial = journal.prepare({
        id: "operation",
        action: "install",
        spec,
        desiredEnabled: true,
    });
    journal.save({
        ...initial,
        phase: "restoring-enablement",
        status: "interrupted",
        recoveryRequired: true,
    });
    const state: ServicePlatformState = {
        state: "stopped",
        running: false,
        loaded: true,
        enabled: true,
        definitionPath: files.definition,
        processId: null,
        identity: null,
        quiescent: true,
    };
    const effects: string[] = [];
    const platform = {
        inspect: vi.fn(async () => structuredClone(state)),
        quiesce: vi.fn(async () => effects.push("quiesce")),
        reload: vi.fn(async () => effects.push("reload")),
        start: vi.fn(async () => effects.push("start")),
    };
    return { host, files, workspace, journal, state, platform, effects };
}

it("captures a restoring-enablement Windows install with candidate and ACL anchors", () => {
    const f = fixture();
    const captured = captureInstalledManagerCandidate(f.journal.read("operation"), f.host);
    proof.acl = "d".repeat(64);
    expect(() => captured.verify()).toThrow("保留恢复门禁");
    captured.dispose();
    expect(readServiceMigrationPending(f.workspace)?.operationId).toBe("operation");
});

it("reconciles an achieved Windows install without redispatch and releases only its gate", async () => {
    const f = fixture();
    const result = await reconcileManagerServiceOperation("operation", "system", f.host, {
        platform: f.platform,
    });
    expect(result).toMatchObject({
        phase: "completed",
        status: "succeeded",
        recoveryRequired: false,
    });
    expect(readServiceMigrationPending(f.workspace)).toBeNull();
    expect(f.effects).toEqual([]);
    expect(f.platform.inspect.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it("keeps the gate when the pending operation or second SCM read does not match", async () => {
    const foreign = fixture();
    fs.writeFileSync(
        path.join(foreign.workspace, ".control/migration-pending.json"),
        JSON.stringify({ schemaVersion: 1, operationId: "foreign", desired: "running" }),
    );
    await expect(
        reconcileManagerServiceOperation("operation", "system", foreign.host, {
            platform: foreign.platform,
        }),
    ).rejects.toThrow("未重放系统动作");
    expect(readServiceMigrationPending(foreign.workspace)?.operationId).toBe("foreign");
    expect(foreign.effects).toEqual([]);

    const drift = fixture();
    drift.platform.inspect
        .mockResolvedValueOnce(structuredClone(drift.state))
        .mockResolvedValueOnce(structuredClone(drift.state))
        .mockResolvedValueOnce(structuredClone(drift.state))
        .mockResolvedValueOnce({ ...drift.state, enabled: false });
    await expect(
        reconcileManagerServiceOperation("operation", "system", drift.host, {
            platform: drift.platform,
        }),
    ).rejects.toThrow("未重放系统动作");
    expect(readServiceMigrationPending(drift.workspace)?.operationId).toBe("operation");
    expect(drift.effects).toEqual([]);
});

it.each(["before", "after"])(
    "reconciles a releasing crash %s marker deletion without replay",
    async point => {
        const f = fixture();
        const record = f.journal.read("operation");
        f.journal.save({ ...record, phase: "releasing" });
        if (point === "after")
            fs.unlinkSync(path.join(f.workspace, ".control/migration-pending.json"));
        const result = await reconcileManagerServiceOperation("operation", "system", f.host, {
            platform: f.platform,
        });
        expect(result).toMatchObject({ phase: "completed", status: "succeeded" });
        expect(readServiceMigrationPending(f.workspace)).toBeNull();
        expect(f.effects).toEqual([]);
    },
);
