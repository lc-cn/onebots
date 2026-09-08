import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runManagerDoctor, type ManagerDoctorCheck } from "./manager-doctor.js";
import type { ManagerServiceStatus } from "./manager-service-status.js";
import type { ServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/manager-doctor-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, ".control"), { recursive: true, mode: 0o700 });
    const host: ServiceHost = {
        platform: "linux",
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: vi.fn(() => {
            throw new Error("unexpected OS effect");
        }),
        spawn: vi.fn(async () => {
            throw new Error("unexpected process effect");
        }),
    };
    const diagnostics = {
        schemaVersion: 1 as const,
        manager: { id: "manager-1", pid: 321, version: "1.0.0" },
        management: { host: "127.0.0.1", port: 6727 },
        gateway: {
            actual: "stopped" as const,
            desired: "stopped" as const,
            recoveryRequired: false,
        },
        configuration: {
            state: "ready" as "ready" | "damaged" | "unavailable",
            recoveryRequired: false,
        },
        generation: { activeId: null, recoveryRequired: false },
        processOwnership: { available: true },
        serviceMigration: { pending: false, recoveryRequired: false },
    };
    const inspectDiagnostics = vi.fn(async () => structuredClone(diagnostics));
    const inspectService = vi.fn(
        async (): Promise<ManagerServiceStatus> => ({
            schemaVersion: 1,
            scope: "user",
            installation: "control",
            serviceRecoveryRequired: false,
            recovery: {
                serviceRecoveryRequired: false,
                readable: true,
                truncated: false,
                operations: [],
            },
            manager: { state: "running", enabled: true, loaded: true, pid: 321, ipc: "available" },
            gateway: {
                actual: "stopped",
                desired: "stopped",
                recoveryRequired: false,
                knownConfigurationFailure: false,
            },
            diagnostic: null,
        }),
    );
    const probe = vi.fn(
        async (): Promise<ManagerDoctorCheck[]> => [
            { id: "web", status: "pass", message: "管理端可用" },
        ],
    );
    const deps = { inspectDiagnostics, inspectService, probe };
    function service() {
        const files = getServiceFiles("user", host);
        fs.mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(
            files.metadata,
            JSON.stringify({
                schemaVersion: 1,
                runtimeKind: "control",
                scope: "user",
                workspace,
                workingDirectory: root,
                nodePath: process.execPath,
                binPath: "/app/bin.js",
                host: "127.0.0.1",
                port: 6727,
            }),
            { mode: 0o600 },
        );
    }
    return { root, workspace, host, diagnostics, deps, service };
}
describe("manager doctor read-only diagnostics", () => {
    it("does not turn an intentionally stopped manager into an IPC failure or start it", async () => {
        const f = fixture();
        f.service();
        const state = await f.deps.inspectService();
        state.manager = {
            state: "stopped",
            enabled: true,
            loaded: true,
            pid: null,
            ipc: "not-queried",
        };
        f.deps.inspectService.mockResolvedValue(state);
        const report = await runManagerDoctor({}, f.host, f.deps);
        expect(report.exitCode).toBe(0);
        expect(report.checks).toContainEqual(
            expect.objectContaining({ id: "manager-offline", status: "warn" }),
        );
        expect(f.deps.inspectDiagnostics).not.toHaveBeenCalled();
        expect(f.deps.probe).not.toHaveBeenCalled();
    });
    it("rejects fix before querying dependencies or creating files", async () => {
        const f = fixture();
        const before = fs.readdirSync(f.root, { recursive: true });
        const result = await runManagerDoctor({ dataDir: f.workspace, fix: true }, f.host, f.deps);
        expect(result.exitCode).toBe(1);
        for (const fn of Object.values(f.deps)) expect(fn).not.toHaveBeenCalled();
        expect(fs.readdirSync(f.root, { recursive: true })).toEqual(before);
        expect(f.host.exec).not.toHaveBeenCalled();
        expect(f.host.spawn).not.toHaveBeenCalled();
    });
    it("diagnoses a foreground blank workspace without requiring a system service or generation", async () => {
        const f = fixture();
        const result = await runManagerDoctor({ dataDir: f.workspace }, f.host, f.deps);
        expect(result).toMatchObject({ schemaVersion: 1, exitCode: 0 });
        expect(result.checks.some(check => check.status === "fail")).toBe(false);
        expect(f.deps.inspectService).not.toHaveBeenCalled();
        expect(f.deps.probe).toHaveBeenCalled();
        expect(f.host.exec).not.toHaveBeenCalled();
    });
    it("reports damaged configuration while still probing management and preserving original bytes", async () => {
        const f = fixture();
        f.diagnostics.configuration.state = "damaged";
        const file = path.join(f.workspace, "config.yaml");
        const bytes = Buffer.from("synthetic-secret: [\r\n");
        fs.writeFileSync(file, bytes);
        const result = await runManagerDoctor({ dataDir: f.workspace }, f.host, f.deps);
        expect(result.exitCode).toBe(1);
        expect(f.deps.probe).toHaveBeenCalled();
        expect(fs.readFileSync(file)).toEqual(bytes);
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    });
    it("rejects manager identity change across the probe", async () => {
        const f = fixture();
        f.deps.probe.mockImplementation(async () => {
            f.diagnostics.manager.id = "manager-2";
            return [];
        });
        const result = await runManagerDoctor({ dataDir: f.workspace }, f.host, f.deps);
        expect(result.exitCode).toBe(1);
        expect(f.deps.inspectDiagnostics.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    it("rejects service OS versus diagnostics PID mismatch", async () => {
        const f = fixture();
        f.service();
        f.diagnostics.manager.pid = 999;
        const result = await runManagerDoctor({}, f.host, f.deps);
        expect(result.exitCode).toBe(1);
        expect(f.deps.inspectService).toHaveBeenCalled();
    });
    it.each([false, true])("strict=%s controls whether warning checks fail", async strict => {
        const f = fixture();
        f.deps.probe.mockResolvedValue([
            { id: "warning", status: "warn", message: "可选检查未完成" },
        ]);
        const result = await runManagerDoctor({ dataDir: f.workspace, strict }, f.host, f.deps);
        expect(result.exitCode).toBe(strict ? 1 : 0);
    });
    it.each(["inspectDiagnostics", "probe"] as const)(
        "does not expose %s exceptions",
        async key => {
            const f = fixture();
            f.deps[key].mockRejectedValue(new Error("synthetic-secret raw credentials"));
            const result = await runManagerDoctor({ dataDir: f.workspace }, f.host, f.deps);
            expect(result.exitCode).toBe(1);
            expect(JSON.stringify(result)).not.toContain("synthetic-secret");
            expect(f.host.exec).not.toHaveBeenCalled();
            expect(f.host.spawn).not.toHaveBeenCalled();
        },
    );
    it("does not create an absent target workspace", async () => {
        const f = fixture();
        const missing = path.join(f.root, "missing");
        const result = await runManagerDoctor({ dataDir: missing }, f.host, f.deps);
        expect(result.exitCode).toBe(1);
        expect(fs.existsSync(missing)).toBe(false);
        expect(f.deps.inspectDiagnostics).not.toHaveBeenCalled();
    });
});
