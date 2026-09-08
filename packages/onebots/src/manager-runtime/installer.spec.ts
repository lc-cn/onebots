import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGenerationPlan } from "../installation/generation-plan.js";
import { GenerationStore } from "../installation/generation-store.js";
import { verifyGeneration } from "../installation/generation-verify.js";
import { verifyManagerCandidate } from "../verification/manager-candidate.js";
import { ManagerCandidateInstaller } from "./installer.js";
vi.mock("../installation/generation-verify.js", () => ({ verifyGeneration: vi.fn() }));
vi.mock("../verification/manager-candidate.js", () => ({ verifyManagerCandidate: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
    vi.resetAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-installer-"));
    roots.push(root);
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
    const identity = {
        planDigest: plan.digest,
        hostVersion: plan.host.version,
        coreVersion: plan.core.version,
        nodeAbi: plan.nodeAbi,
        platform: plan.platform,
        arch: plan.arch,
    };
    const download = vi.fn(async ({ directory }: { directory: string }) => {
        for (const artifact of [plan.host, plan.core]) {
            const folder = path.join(directory, "node_modules", artifact.name);
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(
                path.join(folder, "package.json"),
                JSON.stringify({ name: artifact.name, version: artifact.version }),
            );
        }
        fs.writeFileSync(path.join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    });
    vi.mocked(verifyGeneration).mockImplementation(async directory => {
        fs.writeFileSync(path.join(directory, "schemas.json"), "{}");
        return {
            ...identity,
            checks: {
                packageIdentity: true,
                peerDependencies: true,
                singleHost: true,
                loadRegistration: true,
                schemas: true,
            },
        };
    });
    vi.mocked(verifyManagerCandidate).mockResolvedValue({
        schemaVersion: 1,
        ...identity,
        checks: {
            managementStartup: true,
            webAssets: true,
            anonymousDenied: true,
            authenticationV2: true,
            maintenance: true,
            closed: true,
        },
    });
    const store = new GenerationStore({
        root: path.join(root, "candidates"),
        isActive: () => false,
    });
    const options = { store, operationsDirectory: path.join(root, "operations"), download };
    return {
        root,
        plan,
        store,
        options,
        download,
        installer: new ManagerCandidateInstaller(options),
    };
}
it("依赖验证和维护启动同时通过才提交，重开和重复请求不重派", async () => {
    const f = fixture();
    const result = await f.installer.install("prepare", f.plan);
    expect(result.phase).toBe("verified");
    expect(vi.mocked(verifyGeneration).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(verifyManagerCandidate).mock.invocationCallOrder[0],
    );
    expect(f.installer.readCandidate(result.candidateId!).management.checks.closed).toBe(true);
    await f.installer.close();
    const reopened = new ManagerCandidateInstaller(f.options);
    expect((await reopened.install("prepare", f.plan)).phase).toBe("verified");
    expect(f.download).toHaveBeenCalledTimes(1);
    await reopened.close();
});
it.each(["dependencies", "management"])("%s失败无成功收据，重复请求仍返回失败", async phase => {
    const f = fixture();
    vi.mocked(
        phase === "dependencies" ? verifyGeneration : verifyManagerCandidate,
    ).mockRejectedValue(new Error("private diagnostic"));
    const result = await f.installer.install("failure", f.plan);
    expect(result.phase).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("private diagnostic");
    expect(() => f.store.readVerified(result.candidateId!)).toThrow();
    expect((await f.installer.install("failure", f.plan)).phase).toBe("failed");
    expect(f.download).toHaveBeenCalledTimes(1);
    if (phase === "dependencies") expect(verifyManagerCandidate).not.toHaveBeenCalled();
    await f.installer.close();
});
it.each(["missing", "mismatch", "symlink", "public"])(
    "%s的管理证明不能退回普通网关收据",
    async kind => {
        const f = fixture();
        const result = await f.installer.install("proof", f.plan);
        const candidate = f.installer.readCandidate(result.candidateId!);
        const file = path.join(candidate.directory, "manager-verification.json");
        if (kind === "missing") fs.unlinkSync(file);
        if (kind === "mismatch") {
            const proof = JSON.parse(fs.readFileSync(file, "utf8"));
            proof.candidateId = "other";
            fs.writeFileSync(file, JSON.stringify(proof));
        }
        if (kind === "symlink") {
            fs.renameSync(file, `${file}.original`);
            fs.symlinkSync(`${file}.original`, file);
        }
        if (kind === "public") fs.chmodSync(file, 0o644);
        expect(() => f.installer.status("proof")).toThrow();
        await expect(f.installer.install("proof", f.plan)).rejects.toThrow();
        expect(f.download).toHaveBeenCalledTimes(1);
        await f.installer.close();
    },
);
it("带平台扩展的计划在任何下载或持久操作之前拒绝", async () => {
    const f = fixture();
    const plan = createGenerationPlan({
        ...f.plan,
        selection: { adapters: ["mock"], protocols: [], applications: [] },
        extensions: [
            {
                type: "adapter",
                name: "mock",
                packageName: "@onebots/adapter-mock",
                version: "1.0.0",
                spec: "1.0.0",
                peerDependencies: {},
            },
        ],
    });
    await expect(f.installer.install("invalid", plan)).rejects.toThrow("不能包含");
    expect(f.download).not.toHaveBeenCalled();
    expect(fs.readdirSync(f.options.operationsDirectory)).toEqual([]);
    await f.installer.close();
});
