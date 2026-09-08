import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    bootstrapManagerService,
    type ManagerBootstrapRequest,
} from "./manager-service-bootstrap.js";
import { getServiceFiles } from "./service-files.js";
import { ServiceOperationStorage } from "./service-operation-storage.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import type { GenerationPlan } from "./installation/generation-plan.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform } from "./service-platform.js";

const mock = vi.hoisted(() => ({
    install: vi.fn(),
    status: vi.fn(),
    readCandidate: vi.fn(),
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
        directory: path.join(root, "candidate"),
    };
    fs.mkdirSync(path.join(candidate.directory, "node_modules/onebots/lib"), { recursive: true });
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
        const result = { phase: "verified", planDigest: plan.digest, candidateId: candidate.id };
        mock.status.mockReturnValue(result);
        return result;
    });
    mock.readCandidate.mockReturnValue(candidate);
    mock.digest.mockReturnValue("a".repeat(64));
    mock.verify.mockReturnValue(candidate);
    return { root, files, workspace, request, dependencies, host, effects, candidate };
}
describe("immutable manager bootstrap binding", () => {
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
