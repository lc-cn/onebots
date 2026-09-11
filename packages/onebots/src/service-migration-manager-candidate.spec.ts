import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { acquireControlWorkspace } from "./control/workspace.js";
import { prepareServiceMigrationManagerCandidate } from "./service-migration-manager-candidate.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";
import type { GenerationPlan } from "./installation/generation-plan.js";
import type { ServiceMigrationManagerCandidateDependencies } from "./service-migration-manager-candidate.js";

const mock = vi.hoisted(() => ({
    install: vi.fn(),
    status: vi.fn(),
    read: vi.fn(),
    close: vi.fn(),
    verify: vi.fn(),
    digest: vi.fn(),
}));
vi.mock("./manager-runtime/installer.js", () => ({
    ManagerCandidateInstaller: class {
        install = mock.install;
        status = mock.status;
        readCandidate = mock.read;
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
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/migration-manager-"));
    roots.push(root);
    const state = path.join(root, "state");
    fs.mkdirSync(state, { mode: 0o700 });
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        previousRunning: true,
        previousEnabled: true,
        files: [],
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: path.join(root, "workspace"),
            nodePath: process.execPath,
            binPath: path.join(root, "old/lib/bin.js"),
            workingDirectory: path.join(root, "old"),
            host: "127.0.0.1",
            port: 6727,
        },
    };
    const id = "10000000-0000-4000-8000-000000000001";
    const home = path.join(state, "manager-artifacts");
    const binding = path.join(home, "migrations", id);
    const candidate = {
        id: "20000000-0000-4000-8000-000000000002",
        directory: path.join(home, "versions/20000000-0000-4000-8000-000000000002"),
        operationId: `migration-${id}`,
        planDigest: "",
    };
    const dependencies: ServiceMigrationManagerCandidateDependencies = {
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
    mock.read.mockReturnValue(candidate);
    mock.digest.mockReturnValue("a".repeat(64));
    return {
        root,
        state,
        home,
        binding,
        backup,
        id,
        candidate,
        dependencies,
        run: () => prepareServiceMigrationManagerCandidate(backup, state, id, dependencies),
    };
}

it("prepares only a manager candidate and preserves all original service parameters", async () => {
    const f = fixture();
    const original = structuredClone(f.backup);
    const result = await f.run();
    expect(result).toEqual({
        digest: "a".repeat(64),
        spec: {
            ...f.backup.target,
            workingDirectory: f.candidate.directory,
            binPath: path.join(f.candidate.directory, "node_modules/onebots/lib/bin.js"),
        },
    });
    expect(f.backup).toEqual(original);
    expect(mock.install).toHaveBeenCalledWith(
        `migration-${f.id}`,
        expect.objectContaining({
            extensions: [],
            selection: { adapters: [], protocols: [], applications: [] },
        }),
    );
    expect(mock.verify).toHaveBeenCalledWith(result.spec, result.digest);
    expect(fs.existsSync(path.join(f.home, "bootstrap"))).toBe(false);
    expect(fs.existsSync(path.join(f.state, "manager-operations"))).toBe(false);
    expect(fs.existsSync(f.backup.target.workspace)).toBe(false);
    expect(await f.run()).toEqual(result);
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(mock.status).toHaveBeenCalledWith(`migration-${f.id}`);
    expect(mock.close).toHaveBeenCalledTimes(2);
});

it.each(["failed", "interrupted", "downloading"])(
    "preserves %s and refuses retry dispatch",
    async phase => {
        const f = fixture();
        mock.install.mockImplementation(async () => {
            const result = { phase };
            mock.status.mockReturnValue(result);
            return result;
        });
        await expect(f.run()).rejects.toThrow();
        const intent = fs.readFileSync(path.join(f.binding, "intent.json"));
        await expect(f.run()).rejects.toThrow();
        expect(fs.readFileSync(path.join(f.binding, "intent.json"))).toEqual(intent);
        expect(fs.existsSync(path.join(f.binding, "candidate.json"))).toBe(false);
        expect(mock.install).toHaveBeenCalledTimes(1);
        expect(mock.verify).not.toHaveBeenCalled();
        acquireControlWorkspace(f.home)();
    },
);

it("does not replay when installation returned an unknown result before its journal exists", async () => {
    const f = fixture();
    mock.install.mockRejectedValue(new Error("unknown outcome"));
    await expect(f.run()).rejects.toThrow("unknown outcome");
    mock.status.mockImplementation(() => {
        throw new Error("missing operation");
    });
    await expect(f.run()).rejects.toThrow("missing operation");
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(f.binding, "intent.json"))).toBe(true);
});

it.each(["plan", "target"])("rejects changed %s without reinstalling", async change => {
    const f = fixture();
    await f.run();
    if (change === "plan")
        f.dependencies.artifacts.host = { name: "onebots", version: "1.0.1", spec: "1.0.1" };
    else f.backup.target.port = 6728;
    await expect(f.run()).rejects.toThrow();
    expect(mock.install).toHaveBeenCalledTimes(1);
});

it("identity verification failure retains evidence and releases the artifact lock", async () => {
    const f = fixture();
    mock.verify.mockImplementation(() => {
        throw new Error("invalid proof");
    });
    await expect(f.run()).rejects.toThrow("invalid proof");
    expect(fs.existsSync(path.join(f.binding, "intent.json"))).toBe(true);
    expect(fs.existsSync(path.join(f.binding, "candidate.json"))).toBe(false);
    expect(mock.close).toHaveBeenCalledOnce();
    acquireControlWorkspace(f.home)();
});

it.each(["home", "migrations"])("rejects a symlinked %s before downloading", async component => {
    const f = fixture();
    const outside = path.join(f.root, "outside");
    fs.mkdirSync(outside, { mode: 0o700 });
    if (component === "migrations") fs.mkdirSync(f.home, { mode: 0o700 });
    fs.symlinkSync(outside, component === "home" ? f.home : path.join(f.home, "migrations"));
    await expect(f.run()).rejects.toThrow();
    expect(mock.install).not.toHaveBeenCalled();
    expect(fs.readdirSync(outside)).toEqual([]);
});

it("missing intent with a bound candidate cannot recreate installation history", async () => {
    const f = fixture();
    await f.run();
    fs.unlinkSync(path.join(f.binding, "intent.json"));
    await expect(f.run()).rejects.toThrow();
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(f.binding, "intent.json"))).toBe(false);
});

it("lost candidate acknowledgement can bind a verified original operation without installation", async () => {
    const f = fixture();
    const result = await f.run();
    fs.unlinkSync(path.join(f.binding, "candidate.json"));
    expect(await f.run()).toEqual(result);
    expect(mock.install).toHaveBeenCalledTimes(1);
    expect(mock.status).toHaveBeenCalledWith(`migration-${f.id}`);
});

it("freezes local artifacts so removal of the original tarball does not change the bound plan", async () => {
    const f = fixture();
    const source = path.join(f.root, "onebots.tgz");
    const bytes = Buffer.from("fixture artifact bytes");
    fs.writeFileSync(source, bytes, { mode: 0o600 });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    f.dependencies.artifacts.host = {
        name: "onebots",
        version: "1.0.0",
        spec: `file:${source}`,
        sha256,
    };
    const result = await f.run();
    const frozen = path.join(f.home, "artifacts", `${sha256}.tgz`);
    expect(fs.readFileSync(frozen)).toEqual(bytes);
    expect(mock.install).toHaveBeenCalledWith(
        `migration-${f.id}`,
        expect.objectContaining({
            host: expect.objectContaining({ spec: `file:${frozen}`, sha256 }),
        }),
    );
    fs.unlinkSync(source);
    expect(await f.run()).toEqual(result);
    expect(mock.install).toHaveBeenCalledTimes(1);
});

it("rejects a candidate bound to a different installation operation", async () => {
    const f = fixture();
    f.candidate.operationId = "another-operation";
    await expect(f.run()).rejects.toThrow();
    expect(mock.verify).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(f.binding, "candidate.json"))).toBe(false);
});

it("refuses modified candidate receipt without overwriting evidence", async () => {
    const f = fixture();
    await f.run();
    const file = path.join(f.binding, "candidate.json");
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    receipt.digest = "b".repeat(64);
    const content = JSON.stringify(receipt);
    fs.writeFileSync(file, content, { mode: 0o600 });
    await expect(f.run()).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(content);
    expect(mock.install).toHaveBeenCalledTimes(1);
});
