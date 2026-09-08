import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlManagerService } from "./manager-service-controller.js";
import { getServiceFiles } from "./service-files.js";
import { renderManagerSystemdUnit } from "./manager-service-definition.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
import type { MigrationManagerState } from "./service-migration-manager.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(running = false) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/manager-controller-"));
    roots.push(root);
    const host: ServiceHost = {
        platform: "linux",
        homedir: root,
        env: {},
        exec: () => "v24.0.0",
        spawn: async () => {
            throw new Error("unexpected spawn");
        },
    };
    const files = getServiceFiles("user", host),
        workspace = path.join(root, "workspace");
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        workingDirectory: workspace,
        nodePath: process.execPath,
        binPath: path.join(root, "bin.js"),
        host: "127.0.0.1",
        port: 6727,
    };
    for (const directory of [
        path.dirname(files.definition),
        files.stateDir,
        path.join(workspace, ".control"),
    ])
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(spec.binPath, "export {};\n", { mode: 0o600 });
    fs.writeFileSync(files.metadata, JSON.stringify(spec), { mode: 0o600 });
    fs.writeFileSync(files.definition, renderManagerSystemdUnit(spec), { mode: 0o600 });
    fs.writeFileSync(path.join(workspace, "config.yaml"), "synthetic-secret: [", { mode: 0o600 });
    const gateway = path.join(workspace, ".control/gateway.json");
    fs.writeFileSync(gateway, JSON.stringify({ desired: "running", actual: "failed" }), {
        mode: 0o600,
    });
    let state: ServicePlatformState = {
        state: running ? "running" : "stopped",
        running,
        enabled: true,
        loaded: true,
        definitionPath: files.definition,
        processId: running ? 100 : null,
        identity: running ? "old-os-identity" : null,
        quiescent: !running,
    };
    let currentId = "10000000-0000-4000-8000-000000000001",
        time = 0;
    const events: string[] = [];
    const controls = { proof: true, failStart: false, sameManager: false, wrongPid: false };
    const platform: ServicePlatform = {
        inspect: vi.fn(async () => structuredClone(state)),
        quiesce: async () => {
            events.push("quiesce");
            state = {
                ...state,
                state: "stopped",
                running: false,
                enabled: false,
                processId: null,
                identity: null,
                quiescent: true,
            };
        },
        reload: async enabled => {
            events.push(`reload:${enabled}`);
            state = { ...state, enabled };
        },
        start: async () => {
            events.push("start");
            const operationDirectory = path.join(files.stateDir, "manager-operations");
            const operationName = fs
                .readdirSync(operationDirectory)
                .find(name => name.endsWith(".json"))!;
            expect(
                JSON.parse(fs.readFileSync(path.join(operationDirectory, operationName), "utf8")),
            ).toMatchObject({ status: "running", phase: "starting" });
            expect(() => acquireServiceMigrationLock(files.stateDir)).toThrow();
            if (controls.failStart) throw new Error("synthetic-secret");
            state = {
                ...state,
                state: "running",
                running: true,
                processId: 200,
                identity: "new-os-identity",
                quiescent: false,
            };
            if (!controls.sameManager) currentId = "10000000-0000-4000-8000-000000000002";
        },
    };
    const dependencies = {
        platform: () => platform,
        inspectManager: vi.fn(
            async (): Promise<MigrationManagerState> => ({
                schemaVersion: 1,
                manager: {
                    id: currentId,
                    pid: controls.wrongPid ? 999 : state.processId!,
                    version: "1.0.0",
                },
                gateway: { desired: "running", actual: "failed", recoveryRequired: false },
                serviceMigration: { pending: false, recoveryRequired: false },
                knownConfigurationFailure: true,
            }),
        ),
        confirmStopped: vi.fn(async () => {
            events.push("proof");
            return controls.proof;
        }),
        now: () => time,
        sleep: async (milliseconds: number) => {
            time += milliseconds;
        },
        readinessTimeoutMs: 10,
    };
    return {
        setFailed: () => {
            state = {
                ...state,
                state: "failed",
                running: false,
                processId: null,
                identity: null,
                quiescent: true,
            };
        },
        root,
        host,
        files,
        workspace,
        spec,
        gateway,
        events,
        controls,
        dependencies,
        platform,
    };
}
describe("ordinary manager lifecycle through persistent journal", () => {
    it("start ignores bad YAML and verifies only the manager, persisting intent before start", async () => {
        const test = fixture();
        const result = await controlManagerService("start", "user", test.host, test.dependencies);
        expect(result.status).toBe("succeeded");
        expect(test.events).toEqual(["proof", "start"]);
        expect(fs.readFileSync(path.join(test.workspace, "config.yaml"), "utf8")).toBe(
            "synthetic-secret: [",
        );
        expect(
            new FileManagerServiceJournal(
                path.join(test.files.stateDir, "manager-operations"),
            ).read(result.id),
        ).toEqual(result);
    });
    it("stop restores enabled and leaves gateway desired untouched", async () => {
        const test = fixture(true);
        const original = fs.readFileSync(test.gateway);
        const result = await controlManagerService("stop", "user", test.host, test.dependencies);
        expect(result).toMatchObject({ status: "succeeded", desiredEnabled: true });
        expect(test.events).toEqual(["quiesce", "proof", "reload:true", "proof"]);
        expect(fs.readFileSync(test.gateway)).toEqual(original);
        expect(test.dependencies.inspectManager).not.toHaveBeenCalled();
    });
    it("restart keeps one lock through stop proof, enabled restoration and new manager identity", async () => {
        const test = fixture(true);
        const result = await controlManagerService("restart", "user", test.host, test.dependencies);
        expect(result.status).toBe("succeeded");
        expect(test.events).toEqual(["quiesce", "proof", "reload:true", "proof", "start"]);
        expect(test.dependencies.inspectManager).toHaveBeenCalledTimes(2);
    });
    it("false stop proof forbids reload or restart and gates later actions", async () => {
        const test = fixture(true);
        test.controls.proof = false;
        const result = await controlManagerService("restart", "user", test.host, test.dependencies);
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(test.events).toEqual(["quiesce", "proof"]);
        await expect(
            controlManagerService("start", "user", test.host, test.dependencies),
        ).rejects.toThrow("尚待对账");
        expect(test.events).toEqual(["quiesce", "proof"]);
    });
    it.each(["sameManager", "wrongPid"] as const)(
        "%s cannot satisfy restart verification",
        async field => {
            const test = fixture(true);
            test.controls[field] = true;
            expect(
                await controlManagerService("restart", "user", test.host, test.dependencies),
            ).toMatchObject({ status: "interrupted", recoveryRequired: true });
            if (field === "wrongPid") expect(test.events).toEqual([]);
            else expect(test.events.filter(event => event === "start")).toHaveLength(1);
        },
    );
    it("unfinished migration blocks before platform mutation", async () => {
        const test = fixture();
        const journal = new FileServiceMigrationJournal(
            path.join(test.files.stateDir, "migrations"),
        );
        journal.prepare("old-migration", {
            schemaVersion: 1,
            target: test.spec,
            previousRunning: false,
            previousEnabled: true,
            files: [
                ["definition", test.files.definition],
                ["metadata", test.files.metadata],
                ["configuration", path.join(test.workspace, "config.yaml")],
            ].map(([role, file]) => ({
                role: role as "definition" | "metadata" | "configuration",
                path: file,
                mode: 0o600,
                contentBase64: fs.readFileSync(file).toString("base64"),
            })),
        });
        await expect(
            controlManagerService("start", "user", test.host, test.dependencies),
        ).rejects.toThrow("迁移尚待对账");
        expect(test.events).toEqual([]);
    });
    it.each(["legacy", "invalid"])("%s metadata causes zero OS changes", async kind => {
        const test = fixture();
        fs.writeFileSync(
            test.files.metadata,
            kind === "invalid"
                ? "{"
                : JSON.stringify({
                      scope: "user",
                      configPath: path.join(test.workspace, "config.yaml"),
                      adapters: [],
                      protocols: [],
                      nodePath: process.execPath,
                      binPath: "/app/bin.js",
                      workingDirectory: test.workspace,
                  }),
        );
        await expect(
            controlManagerService("start", "user", test.host, test.dependencies),
        ).rejects.toThrow();
        expect(test.events).toEqual([]);
        expect(test.platform.inspect).not.toHaveBeenCalled();
    });
    it("failed start remains unknown without inverse stop/reload compensation", async () => {
        const test = fixture();
        test.controls.failStart = true;
        const result = await controlManagerService("start", "user", test.host, test.dependencies);
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
        expect(test.events).toEqual(["proof", "start"]);
    });
});

it("failure to persist starting intent never calls OS start or compensates backwards", async () => {
    const test = fixture();
    const original = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (
            String(to).includes("manager-operations") &&
            JSON.parse(fs.readFileSync(String(from), "utf8")).phase === "starting"
        )
            throw new Error("synthetic-secret");
        original(from, to);
    });
    const result = await controlManagerService("start", "user", test.host, test.dependencies);
    expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
    expect(test.events).toEqual(["proof"]);
    vi.restoreAllMocks();
    expect(
        new FileManagerServiceJournal(path.join(test.files.stateDir, "manager-operations")).health()
            .recoveryRequired,
    ).toBe(true);
});

it.each(["missing-bin", "old-node"])(
    "%s prevents restart before quiescing the existing manager",
    async scenario => {
        const test = fixture(true);
        if (scenario === "missing-bin") fs.unlinkSync(test.spec.binPath);
        else test.host.exec = () => "v22.0.0";
        await expect(
            controlManagerService("restart", "user", test.host, test.dependencies),
        ).rejects.toThrow();
        expect(test.events).toEqual([]);
    },
);
it("stop remains available when installed runtime files are unavailable", async () => {
    const test = fixture(true);
    fs.unlinkSync(test.spec.binPath);
    expect((await controlManagerService("stop", "user", test.host, test.dependencies)).status).toBe(
        "succeeded",
    );
    expect(test.events).toEqual(["quiesce", "proof", "reload:true", "proof"]);
});

it("start of a failed manager first quiesces and restores enablement before starting", async () => {
    const test = fixture();
    test.setFailed();
    const result = await controlManagerService("start", "user", test.host, test.dependencies);
    expect(result.status).toBe("succeeded");
    expect(test.events).toEqual(["quiesce", "proof", "reload:true", "proof", "start"]);
});
