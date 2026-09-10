import fs from "node:fs";
import { acquireControlWorkspace } from "./control/workspace.js";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    bootstrapManagerService,
    bootstrapManagerServiceWhileLocked,
    type ManagerBootstrapRequest,
} from "./manager-service-bootstrap.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { reconcileManagerServiceOperation } from "./manager-service-recovery.js";
import { getServiceFiles } from "./service-files.js";
import { ServiceOperationStorage } from "./service-operation-storage.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import type { GenerationPlan } from "./installation/generation-plan.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform } from "./service-platform.js";
import {
    ManagerBootstrapCandidateError,
    ManagerBootstrapSetupError,
    ManagerBootstrapStageError,
} from "./manager-bootstrap-error.js";

const windowsSecurity = vi.hoisted(() => ({
    secureDirectory: vi.fn(),
    secureFile: vi.fn(),
    inspectDirectory: vi.fn(),
    inspectFile: vi.fn(),
}));
vi.mock("./windows-service-security.js", () => ({
    secureWindowsServiceDirectory: windowsSecurity.secureDirectory,
    secureWindowsServiceFile: windowsSecurity.secureFile,
    inspectWindowsServiceDirectorySecurity: windowsSecurity.inspectDirectory,
    inspectWindowsServiceFileSecurity: windowsSecurity.inspectFile,
}));

const mock = vi.hoisted(() => ({
    install: vi.fn(),
    status: vi.fn(),
    readCandidate: vi.fn(),
    readVerified: vi.fn(),
    close: vi.fn(),
    verify: vi.fn(),
    digest: vi.fn(),
}));
vi.mock("./manager-runtime/installer.js", () => ({
    ManagerCandidateInstaller: class {
        install = mock.install;
        status = mock.status;
        readCandidate = mock.readCandidate;
        close = mock.close;
    },
}));
vi.mock("./manager-runtime/identity.js", () => ({ managerCandidateDigest: mock.digest }));
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: mock.verify,
}));
vi.mock("./manager-runtime/reader.js", () => ({ readVerifiedManagerCandidate: mock.readVerified }));
const roots: string[] = [];
afterEach(() => {
    vi.resetAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/manager-bootstrap-"));
    roots.push(root);
    const effects: string[] = [];
    const host: ServiceHost = {
        platform: "linux",
        uid: process.getuid?.(),
        homedir: root,
        env: {},
        exec: (_file, args) => {
            if (args.length === 1 && args[0] === "--version") return "v24.0.0";
            if (!args.includes("show")) throw new Error("unexpected OS effect");
            return "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\nFragmentPath=\n";
        },
        spawn: async () => {
            throw new Error("unexpected process");
        },
    };
    const files = getServiceFiles("user", host);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { mode: 0o700 });
    const candidate = {
        id: "10000000-0000-4000-8000-000000000001",
        directory: path.join(
            files.stateDir,
            "manager-artifacts/versions/10000000-0000-4000-8000-000000000001",
        ),
        operationId: "bootstrap-1",
        planDigest: "",
    };
    fs.mkdirSync(path.join(candidate.directory, "node_modules/onebots/lib"), {
        recursive: true,
        mode: 0o700,
    });
    fs.writeFileSync(
        path.join(candidate.directory, "node_modules/onebots/lib/bin.js"),
        "export {};\n",
    );
    const request: ManagerBootstrapRequest = {
        id: "bootstrap-1",
        service: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace,
            nodePath: process.execPath,
            host: "127.0.0.1",
            port: 6727,
        },
    };
    const platform: ServicePlatform = {
        inspect: async () => ({
            state: "stopped",
            running: false,
            enabled: true,
            loaded: true,
            definitionPath: files.definition,
            processId: null,
            identity: null,
            quiescent: true,
        }),
        quiesce: async () => {
            effects.push("quiesce");
            throw new Error("unexpected stop");
        },
        start: async () => {
            effects.push("start");
            throw new Error("unexpected start");
        },
        reload: async enabled => {
            effects.push(`reload:${enabled}`);
        },
    };
    const dependencies = {
        platform,
        artifacts: {
            host: { name: "onebots", version: "1.0.0", spec: "1.0.0" },
            core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        },
    };
    mock.install.mockImplementation(async (_id: string, plan: GenerationPlan) => {
        candidate.planDigest = plan.digest;
        const result = { phase: "verified", planDigest: plan.digest, candidateId: candidate.id };
        mock.status.mockReturnValue(result);
        return result;
    });
    mock.readCandidate.mockReturnValue(candidate);
    mock.readVerified.mockReturnValue(candidate);
    mock.digest.mockReturnValue("a".repeat(64));
    mock.verify.mockReturnValue(candidate);
    return { root, files, workspace, request, dependencies, host, effects, candidate };
}

function windowsFixture() {
    const fixtureValue = fixture();
    const host: ServiceHost = {
        ...fixtureValue.host,
        platform: "win32",
        isElevated: true,
        windowsSid: "S-1-5-21-1000",
        env: { ProgramData: path.join(fixtureValue.root, "program-data") },
    };
    const files = getServiceFiles("system", host);
    fixtureValue.request.service.scope = "system";
    windowsSecurity.secureDirectory.mockImplementation((_host, directory: string) => {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        return "acl-proof";
    });
    windowsSecurity.secureFile.mockReturnValue("acl-proof");
    windowsSecurity.inspectDirectory.mockReturnValue("acl-proof");
    return { ...fixtureValue, host, files };
}
describe("immutable manager bootstrap binding", () => {
    it("uses the caller-held service lock for an atomic migration bootstrap", async () => {
        const f = fixture();
        const release = acquireServiceMigrationLock(f.files.stateDir);
        try {
            const result = await bootstrapManagerServiceWhileLocked(
                f.request,
                f.dependencies,
                f.host,
            );
            expect(result).toMatchObject({
                id: "bootstrap-1",
                phase: "completed",
                status: "succeeded",
            });
        } finally {
            release();
        }
        // The public entrypoint can immediately reacquire the lock and return the receipt.
        await expect(
            bootstrapManagerService(f.request, f.dependencies, f.host),
        ).resolves.toMatchObject({ id: "bootstrap-1", status: "succeeded" });
    });

    it("preserves the persisted Windows stage error when candidate cleanup also fails", async () => {
        const f = windowsFixture();
        mock.install.mockRejectedValueOnce(new Error("candidate timeout"));
        mock.close.mockRejectedValueOnce(new Error("worker close timeout"));
        const run = bootstrapManagerService(f.request, f.dependencies, f.host);
        const error = await run.catch(value => value);
        expect(error).toBeInstanceOf(ManagerBootstrapStageError);
        expect(error).toMatchObject({
            operationId: "bootstrap-1",
            bootstrapPhase: "candidate-queued",
            code: "CANDIDATE_PREPARATION_FAILED",
        });
        expect(
            (error as ManagerBootstrapStageError & { cleanupErrors?: unknown[] }).cleanupErrors,
        ).toHaveLength(1);
    });

    it("reports the stable operation and completed manager phase when Windows cleanup fails", async () => {
        const f = windowsFixture();
        f.dependencies.assertAbsent = vi.fn(async () => undefined);
        f.dependencies.platform.inspect = async () => ({
            state: "stopped",
            running: false,
            enabled: true,
            loaded: true,
            definitionPath: f.files.definition,
            processId: null,
            identity: null,
            quiescent: true,
        });
        mock.close.mockRejectedValueOnce(new Error("worker close timeout"));
        const error = await bootstrapManagerService(f.request, f.dependencies, f.host).catch(
            value => value,
        );
        expect(error).toBeInstanceOf(ManagerBootstrapStageError);
        expect(error).toMatchObject({
            operationId: "bootstrap-1",
            bootstrapPhase: "manager-completed",
            code: "MANAGER_CLEANUP_FAILED",
        });
        expect(
            (error as ManagerBootstrapStageError & { cleanupErrors?: unknown[] }).cleanupErrors,
        ).toHaveLength(1);
    });

    it("binds the same stable id to candidate and real installation; retry only returns its receipt", async () => {
        const f = fixture();
        const result = await bootstrapManagerService(f.request, f.dependencies, f.host);
        expect(result).toMatchObject({
            id: f.request.id,
            action: "install",
            phase: "completed",
            status: "succeeded",
        });
        expect(f.effects).toEqual(["reload:true"]);
        expect(fs.existsSync(path.join(f.workspace, "config.yaml"))).toBe(false);
        const binding = new ServiceOperationStorage(
            path.join(f.files.stateDir, "manager-artifacts/bootstrap"),
        );
        expect(binding.read("intent.json")).toMatchObject({ id: f.request.id });
        expect(binding.read("candidate.json")).toMatchObject({
            id: f.request.id,
            candidateId: f.candidate.id,
            candidateDigest: "a".repeat(64),
            spec: result.managerSpec,
        });
        expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(result.managerSpec);
        expect(
            new FileManagerServiceJournal(path.join(f.files.stateDir, "manager-operations")).read(
                f.request.id,
            ),
        ).toEqual(result);
        const repeated = await bootstrapManagerService(f.request, f.dependencies, f.host);
        expect(repeated).toEqual(result);
        expect(mock.install).toHaveBeenCalledTimes(1);
        expect(mock.status).toHaveBeenCalledWith(f.request.id);
        expect(f.effects).toEqual(["reload:true"]);
        expect(mock.close).toHaveBeenCalledTimes(2);
    });
    it("a bound candidate with missing download operation refuses instead of reinstalling", async () => {
        const f = fixture();
        const assertAbsent = vi.fn(async () => {
            throw new Error("service absence cannot be proven");
        });
        const dependencies = { ...f.dependencies, assertAbsent };
        await expect(bootstrapManagerService(f.request, dependencies, f.host)).rejects.toThrow(
            "service absence cannot be proven",
        );
        const binding = new ServiceOperationStorage(
            path.join(f.files.stateDir, "manager-artifacts/bootstrap"),
        );
        expect(binding.has("candidate.json")).toBe(true);
        expect(
            fs.existsSync(
                path.join(f.files.stateDir, "manager-operations", `${f.request.id}.json`),
            ),
        ).toBe(false);
        mock.install.mockClear();
        mock.status.mockImplementation(() => {
            throw new Error("download operation missing");
        });
        assertAbsent.mockClear();
        await expect(bootstrapManagerService(f.request, dependencies, f.host)).rejects.toThrow(
            "download operation missing",
        );
        expect(mock.status).toHaveBeenCalledWith(f.request.id);
        expect(mock.install).not.toHaveBeenCalled();
        expect(assertAbsent).not.toHaveBeenCalled();
        expect(f.effects).toEqual([]);
        expect(fs.existsSync(f.files.definition)).toBe(false);
    });
    it("an interrupted registration returns the original record without retrying reload", async () => {
        const f = fixture();
        f.dependencies.platform.reload = async () => {
            f.effects.push("reload:failed");
            throw new Error("synthetic reload failure");
        };
        const result = await bootstrapManagerService(f.request, f.dependencies, f.host);
        expect(result).toMatchObject({
            id: f.request.id,
            status: "interrupted",
            recoveryRequired: true,
        });
        const repeated = await bootstrapManagerService(f.request, f.dependencies, f.host);
        expect(repeated).toEqual(result);
        expect(mock.install).toHaveBeenCalledTimes(1);
        expect(f.effects).toEqual(["reload:failed"]);
        expect(fs.existsSync(f.files.definition)).toBe(true);
    });
    it.each(["prepared", "interrupted"])(
        "a %s candidate never writes service files or dispatches OS",
        async phase => {
            const f = fixture();
            mock.install.mockImplementation(async (_id: string, plan: GenerationPlan) => ({
                phase,
                planDigest: plan.digest,
                candidateId: f.candidate.id,
            }));
            await expect(
                bootstrapManagerService(f.request, f.dependencies, f.host),
            ).rejects.toThrow();
            expect(mock.verify).not.toHaveBeenCalled();
            expect(f.effects).toEqual([]);
            expect(fs.existsSync(f.files.definition)).toBe(false);
            expect(fs.existsSync(f.files.metadata)).toBe(false);
        },
    );
    it.each(["id", "plan", "service"])(
        "rejects changed %s under an existing intent",
        async changed => {
            const f = fixture();
            await bootstrapManagerService(f.request, f.dependencies, f.host);
            if (changed === "id") f.request.id = "another-id";
            if (changed === "plan")
                f.dependencies.artifacts.host = {
                    name: "onebots",
                    version: "1.0.1",
                    spec: "1.0.1",
                };
            if (changed === "service") f.request.service.port = 6728;
            await expect(
                bootstrapManagerService(f.request, f.dependencies, f.host),
            ).rejects.toThrow();
            expect(mock.install).toHaveBeenCalledTimes(1);
            expect(f.effects).toEqual(["reload:true"]);
        },
    );
    it("preserves preexisting metadata without downloading a candidate", async () => {
        const f = fixture();
        fs.mkdirSync(f.files.stateDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(f.files.metadata, "damaged-existing-metadata", { mode: 0o600 });
        await expect(bootstrapManagerService(f.request, f.dependencies, f.host)).rejects.toThrow();
        expect(mock.install).not.toHaveBeenCalled();
        expect(f.effects).toEqual([]);
        expect(fs.readFileSync(f.files.metadata, "utf8")).toBe("damaged-existing-metadata");
    });
    it("candidate identity verification failure leaves the intent but never registers service", async () => {
        const f = fixture();
        mock.verify.mockImplementation(() => {
            throw new Error("invalid candidate proof");
        });
        await expect(bootstrapManagerService(f.request, f.dependencies, f.host)).rejects.toThrow(
            "invalid candidate proof",
        );
        expect(f.effects).toEqual([]);
        expect(fs.existsSync(f.files.definition)).toBe(false);
        const binding = new ServiceOperationStorage(
            path.join(f.files.stateDir, "manager-artifacts/bootstrap"),
        );
        expect(binding.has("intent.json")).toBe(true);
        expect(binding.has("candidate.json")).toBe(false);
        expect(mock.close).toHaveBeenCalledOnce();
    });
});

describe("Windows bootstrap stable diagnostics", () => {
    it("classifies each operation-id preflight without exposing the original failure", async () => {
        const identity = windowsFixture();
        identity.host.isElevated = false;
        await expect(
            bootstrapManagerService(identity.request, identity.dependencies, identity.host),
        ).rejects.toEqual(
            new ManagerBootstrapSetupError("windows-identity", "WINDOWS_IDENTITY_UNAVAILABLE"),
        );

        const state = windowsFixture();
        windowsSecurity.secureDirectory.mockImplementationOnce(() => {
            throw new Error("private state path");
        });
        await expect(
            bootstrapManagerService(state.request, state.dependencies, state.host),
        ).rejects.toMatchObject({
            bootstrapPhase: "windows-state-security",
            code: "WINDOWS_STATE_ACL_FAILED",
        });

        const workspace = windowsFixture();
        windowsSecurity.secureDirectory
            .mockImplementationOnce((_host, directory: string) => {
                fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
                return "acl-proof";
            })
            .mockImplementationOnce(() => {
                throw new Error("private workspace path");
            });
        await expect(
            bootstrapManagerService(workspace.request, workspace.dependencies, workspace.host),
        ).rejects.toMatchObject({
            bootstrapPhase: "windows-workspace-security",
            code: "WINDOWS_WORKSPACE_ACL_FAILED",
        });

        const serviceLock = windowsFixture();
        windowsSecurity.secureFile.mockImplementationOnce(() => {
            throw new Error("private lock ACL");
        });
        await expect(
            bootstrapManagerService(
                serviceLock.request,
                serviceLock.dependencies,
                serviceLock.host,
            ),
        ).rejects.toMatchObject({
            bootstrapPhase: "service-lock",
            code: "SERVICE_LOCK_FAILED",
        });

        const cycle = windowsFixture();
        const managerOperations = path.join(cycle.files.stateDir, "manager-operations");
        fs.mkdirSync(cycle.files.stateDir, { recursive: true });
        fs.writeFileSync(managerOperations, "preserved-invalid-entry");
        await expect(
            bootstrapManagerService(cycle.request, cycle.dependencies, cycle.host),
        ).rejects.toMatchObject({
            bootstrapPhase: "bootstrap-cycle",
            code: "BOOTSTRAP_CYCLE_FAILED",
        });
        expect(fs.readFileSync(managerOperations, "utf8")).toBe("preserved-invalid-entry");
    });

    it("persists a closed bootstrap entry before candidate work starts", async () => {
        const f = windowsFixture();
        mock.install.mockRejectedValue(new Error("private installer path"));
        await expect(
            bootstrapManagerService(f.request, f.dependencies, f.host),
        ).rejects.toBeInstanceOf(ManagerBootstrapStageError);
        expect(
            new ServiceOperationStorage(
                path.join(f.files.stateDir, "manager-bootstrap-entries"),
            ).read(`${f.request.id}.json`),
        ).toEqual({
            schemaVersion: 1,
            id: f.request.id,
            service: expect.objectContaining({ scope: "system", workspace: f.workspace }),
        });
    });

    it("classifies a failure before candidate verification without exposing the original error", async () => {
        const f = windowsFixture();
        mock.install.mockRejectedValue(new Error("private installer path"));
        await expect(
            bootstrapManagerService(f.request, f.dependencies, f.host),
        ).rejects.toMatchObject({
            operationId: f.request.id,
            bootstrapPhase: "candidate-queued",
            code: "CANDIDATE_PREPARATION_FAILED",
        });
    });

    it("preserves the fixed candidate classification after verification", async () => {
        const f = windowsFixture();
        mock.readCandidate.mockImplementation(() => {
            throw new Error("private candidate path");
        });
        const run = bootstrapManagerService(f.request, f.dependencies, f.host);
        await expect(run).rejects.toMatchObject({
            operationId: f.request.id,
            phase: "verified",
            code: "CANDIDATE_READ_FAILED",
        });
        await expect(run).rejects.toBeInstanceOf(ManagerBootstrapCandidateError);
    });

    it("classifies failure before manager journal creation from the bound candidate stage", async () => {
        const f = windowsFixture();
        f.dependencies.assertAbsent = vi.fn(async () => {
            throw new Error("private SCM preflight");
        });
        await expect(
            bootstrapManagerService(f.request, f.dependencies, f.host),
        ).rejects.toMatchObject({
            operationId: f.request.id,
            bootstrapPhase: "manager-preflight",
            code: "MANAGER_PREFLIGHT_FAILED",
        });
    });

    it("derives the persisted manager phase when journal acknowledgement fails", async () => {
        const f = windowsFixture();
        f.dependencies.assertAbsent = vi.fn(async () => undefined);
        const read = ServiceOperationStorage.prototype.read;
        vi.spyOn(ServiceOperationStorage.prototype, "read").mockImplementation(function (name) {
            if (name === `${f.request.id}.json`) throw new Error("private journal read");
            return read.call(this, name);
        });
        const run = bootstrapManagerService(f.request, f.dependencies, f.host);
        await expect(run).rejects.toMatchObject({
            operationId: f.request.id,
            bootstrapPhase: "manager-prepared",
            code: "MANAGER_JOURNAL_FAILED",
        });
        await expect(run).rejects.toBeInstanceOf(ManagerBootstrapStageError);
    });
});

it("successful bootstrap receipt cannot claim a removed service is installed", async () => {
    const f = fixture();
    await bootstrapManagerService(f.request, f.dependencies, f.host);
    fs.unlinkSync(f.files.metadata);
    const effects = [...f.effects];
    await expect(bootstrapManagerService(f.request, f.dependencies, f.host)).rejects.toThrow();
    expect(f.effects).toEqual(effects);
});

describe("bootstrap cold installation reconciliation", () => {
    it("only repairs a lost final acknowledgement after verifying the bound candidate and stopped OS", async () => {
        const f = fixture();
        const result = await bootstrapManagerService(f.request, f.dependencies, f.host);
        const journal = new FileManagerServiceJournal(
            path.join(f.files.stateDir, "manager-operations"),
        );
        journal.save({ ...result, status: "interrupted", recoveryRequired: true });
        const metadata = fs.readFileSync(f.files.metadata);
        const definition = fs.readFileSync(f.files.definition);
        const completed = await reconcileManagerServiceOperation(f.request.id, "user", f.host, {
            platform: f.dependencies.platform,
        });
        expect(completed).toMatchObject({
            id: f.request.id,
            phase: "completed",
            status: "succeeded",
            recoveryRequired: false,
        });
        expect(f.effects).toEqual(["reload:true"]);
        expect(mock.install).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(f.files.metadata)).toEqual(metadata);
        expect(fs.readFileSync(f.files.definition)).toEqual(definition);
        expect(journal.read(f.request.id)).toEqual(completed);
        expect(mock.readVerified).toHaveBeenCalledWith(
            path.join(f.files.stateDir, "manager-artifacts/versions"),
            f.candidate.id,
        );
    });
    it.each(["writing", "damaged-candidate"])(
        "%s evidence cannot clear the recovery gate",
        async mode => {
            const f = fixture();
            const result = await bootstrapManagerService(f.request, f.dependencies, f.host);
            const journal = new FileManagerServiceJournal(
                path.join(f.files.stateDir, "manager-operations"),
            );
            if (mode === "writing") {
                const operations = new ServiceOperationStorage(
                    path.join(f.files.stateDir, "manager-operations"),
                );
                operations.write(`${f.request.id}.json`, {
                    ...result,
                    phase: "writing",
                    status: "interrupted",
                    recoveryRequired: true,
                });
            } else {
                journal.save({ ...result, status: "interrupted", recoveryRequired: true });
                mock.readVerified.mockImplementation(() => {
                    throw new Error("damaged candidate");
                });
            }
            await expect(
                reconcileManagerServiceOperation(f.request.id, "user", f.host, {
                    platform: f.dependencies.platform,
                }),
            ).rejects.toThrow();
            expect(
                new FileManagerServiceJournal(
                    path.join(f.files.stateDir, "manager-operations"),
                ).health().recoveryRequired,
            ).toBe(true);
            expect(f.effects).toEqual(["reload:true"]);
            expect(mock.install).toHaveBeenCalledTimes(1);
        },
    );
});

it("candidate binding replacement during OS inspection preserves recovery and releases locks", async () => {
    const f = fixture();
    const result = await bootstrapManagerService(f.request, f.dependencies, f.host);
    const journal = new FileManagerServiceJournal(
        path.join(f.files.stateDir, "manager-operations"),
    );
    journal.save({ ...result, status: "interrupted", recoveryRequired: true });
    const home = path.join(f.files.stateDir, "manager-artifacts");
    const file = path.join(home, "bootstrap/candidate.json");
    const bytes = fs.readFileSync(file);
    const inspect = f.dependencies.platform.inspect;
    let replaced = false;
    f.dependencies.platform.inspect = async () => {
        if (!replaced) {
            replaced = true;
            fs.unlinkSync(file);
            fs.writeFileSync(file, bytes, { mode: 0o600 });
        }
        return inspect();
    };
    await expect(
        reconcileManagerServiceOperation(f.request.id, "user", f.host, {
            platform: f.dependencies.platform,
        }),
    ).rejects.toThrow();
    expect(journal.read(f.request.id).recoveryRequired).toBe(true);
    expect(f.effects).toEqual(["reload:true"]);
    acquireControlWorkspace(home)();
    acquireControlWorkspace(f.workspace)();
});

it.each(["cycle-symlink", "missing-initial-intent"])(
    "new cycle rejects %s without replacing history",
    async problem => {
        const f = fixture();
        await bootstrapManagerService(f.request, f.dependencies, f.host);
        const home = path.join(f.files.stateDir, "manager-artifacts");
        const metadata = fs.readFileSync(f.files.metadata);
        if (problem === "cycle-symlink") {
            const outside = path.join(f.root, "outside");
            fs.mkdirSync(outside, { mode: 0o700 });
            fs.symlinkSync(outside, path.join(home, "bootstrap-cycles"));
        } else {
            fs.unlinkSync(path.join(home, "bootstrap/intent.json"));
        }
        await expect(
            bootstrapManagerService({ ...f.request, id: "next-install" }, f.dependencies, f.host),
        ).rejects.toThrow();
        expect(mock.install).toHaveBeenCalledTimes(1);
        expect(f.effects).toEqual(["reload:true"]);
        expect(fs.readFileSync(f.files.metadata)).toEqual(metadata);
        if (problem === "cycle-symlink")
            expect(fs.readdirSync(path.join(f.root, "outside"))).toEqual([]);
    },
);

it("automatic cycle selection reuses installed identity instead of creating a new operation", async () => {
    const f = fixture();
    const installed = await bootstrapManagerService(f.request, f.dependencies, f.host);
    const repeated = await bootstrapManagerService(
        { service: f.request.service },
        f.dependencies,
        f.host,
    );
    expect(repeated).toEqual(installed);
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(f.effects).toEqual(["reload:true"]);
});
it("automatic cycle selection does not infer uninstall from missing metadata", async () => {
    const f = fixture();
    await bootstrapManagerService(f.request, f.dependencies, f.host);
    fs.unlinkSync(f.files.metadata);
    await expect(
        bootstrapManagerService({ service: f.request.service }, f.dependencies, f.host),
    ).rejects.toThrow();
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(f.effects).toEqual(["reload:true"]);
});

it("automatic install returns the bound interrupted operation without replay", async () => {
    const f = fixture();
    const installed = await bootstrapManagerService(f.request, f.dependencies, f.host);
    const journal = new FileManagerServiceJournal(
        path.join(f.files.stateDir, "manager-operations"),
    );
    const interrupted = { ...installed, status: "interrupted" as const, recoveryRequired: true };
    journal.save(interrupted);
    expect(
        await bootstrapManagerService({ service: f.request.service }, f.dependencies, f.host),
    ).toEqual(interrupted);
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(f.effects).toEqual(["reload:true"]);
    expect(journal.read(installed.id).recoveryRequired).toBe(true);
});

it.each(["intent.json", "candidate.json"])(
    "automatic interrupted install refuses missing %s without rebuilding history",
    async name => {
        const f = fixture();
        const installed = await bootstrapManagerService(f.request, f.dependencies, f.host);
        const journal = new FileManagerServiceJournal(
            path.join(f.files.stateDir, "manager-operations"),
        );
        const interrupted = {
            ...installed,
            status: "interrupted" as const,
            recoveryRequired: true,
        };
        journal.save(interrupted);
        const file = path.join(f.files.stateDir, "manager-artifacts/bootstrap", name);
        fs.unlinkSync(file);
        await expect(
            bootstrapManagerService({ service: f.request.service }, f.dependencies, f.host),
        ).rejects.toThrow();
        expect(fs.existsSync(file)).toBe(false);
        expect(mock.install).toHaveBeenCalledTimes(1);
        expect(f.effects).toEqual(["reload:true"]);
        expect(journal.read(installed.id)).toEqual(interrupted);
    },
);
