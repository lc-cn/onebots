import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerationPlan } from "./generation-plan.js";
import { GenerationInstaller } from "./generation-installer.js";
import { GenerationStore } from "./generation-store.js";

const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    directories
        .splice(0)
        .forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
});

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-install-journal-"));
    directories.push(root);
    const operationsDirectory = path.join(root, "operations");
    const store = new GenerationStore({
        root: path.join(root, "generations"),
        isActive: () => false,
    });
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
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
    const verify = vi.fn(async (directory: string) => {
        fs.writeFileSync(path.join(directory, "schemas.json"), "{}");
        return {
            planDigest: plan.digest,
            hostVersion: plan.host.version,
            coreVersion: plan.core.version,
            nodeAbi: process.versions.modules,
            platform: process.platform,
            arch: process.arch,
            checks: {
                packageIdentity: true,
                peerDependencies: true,
                singleHost: true,
                loadRegistration: true,
                schemas: true,
            } as const,
        };
    });
    const options = { operationsDirectory, store, download, verify };
    return { root, plan, options, download, verify };
}

describe("GenerationInstaller", () => {
    it.each([
        ["download", "DOWNLOAD_FAILED"],
        ["verify", "VERIFICATION_FAILED"],
    ] as const)("将%s失败持久化为固定阶段码", async (stage, code) => {
        const { plan, options, download, verify } = fixture();
        (stage === "download" ? download : verify).mockRejectedValue(
            new Error("private diagnostic"),
        );
        const installer = new GenerationInstaller(options);
        await expect(installer.install(`failed-${stage}`, plan)).resolves.toMatchObject({
            phase: "failed",
            error: code,
        });
    });

    it("最终持久状态投影不含安装计划或凭据，观察失败不改变结果", async () => {
        const { plan, options } = fixture();
        const onOperation = vi.fn(() => {
            throw new Error("log unavailable");
        });
        const installer = new GenerationInstaller({ ...options, onOperation });
        expect(
            await installer.install("project-install", plan, { token: "private-token" }),
        ).toMatchObject({
            id: "project-install",
            phase: "verified",
        });
        expect(onOperation).toHaveBeenCalledWith({
            id: "project-install",
            action: "installation.install",
            status: "succeeded",
            phase: "verified",
            finishedAt: expect.any(String),
        });
        expect(Object.keys(onOperation.mock.calls[0][0]).sort()).toEqual([
            "action",
            "finishedAt",
            "id",
            "phase",
            "status",
        ]);
    });
    it("收据已完成但最终操作写入失败时记录中断，不误报下载或验证失败", async () => {
        const { plan, options, download, verify } = fixture();
        const installer = new GenerationInstaller(options);
        const rename = fs.renameSync;
        let failedOnce = false;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (
                !failedOnce &&
                String(to).endsWith("/receipt-final.json") &&
                JSON.parse(fs.readFileSync(from, "utf8")).phase === "verified"
            ) {
                failedOnce = true;
                throw new Error("synthetic journal write failure");
            }
            return rename(from, to);
        });
        const result = await installer.install("receipt-final", plan);
        expect(result).toMatchObject({ phase: "interrupted", error: "INTERRUPTED" });
        expect(options.store.readVerified(result.candidateId!).planDigest).toBe(plan.digest);
        expect((await installer.install("receipt-final", plan)).phase).toBe("interrupted");
        expect(download).toHaveBeenCalledTimes(1);
        expect(verify).toHaveBeenCalledTimes(1);
    });

    it("幂等读取verified结果时仍要求对应验证收据有效", async () => {
        const { plan, options } = fixture();
        const installer = new GenerationInstaller(options);
        const installed = await installer.install("receipt-check", plan);
        const candidate = options.store.readVerified(installed.candidateId!);
        fs.unlinkSync(path.join(candidate.directory, "receipt.json"));
        expect(() => installer.status("receipt-check")).toThrow();
        expect(() => installer.install("receipt-check", plan)).toThrow();
    });

    it("接受请求时快照授权参数，不受调用方后续修改影响", async () => {
        const { plan, options, download } = fixture();
        const installer = new GenerationInstaller(options);
        const credential = { token: "accepted-secret" };
        const pending = installer.install("credential", plan, credential);
        credential.token = "mutated-secret";
        await pending;
        expect(download.mock.calls[0][0]).toMatchObject({ token: "accepted-secret" });
        expect(credential.token).toBe("mutated-secret");
    });

    it("重复请求只下载一次，验证收据落盘后才报告verified且不激活", async () => {
        const { plan, options, download } = fixture();
        const installer = new GenerationInstaller(options);
        const first = installer.install("request-1", plan);
        expect(installer.status("request-1").phase).toBe("queued");
        const second = installer.install("request-1", plan);
        const [a, b] = await Promise.all([first, second]);
        expect(a).toEqual(b);
        expect(a.phase).toBe("verified");
        expect(download).toHaveBeenCalledTimes(1);
        expect(options.store.readVerified(a.candidateId!).receipt.planDigest).toBe(plan.digest);
        expect(await installer.install("request-1", plan)).toEqual(a);
        const fresh = new GenerationInstaller(options);
        expect(await fresh.install("request-1", plan)).toEqual(a);
        expect(download).toHaveBeenCalledTimes(1);
    });

    it("下载失败不运行验证，状态不保存第三方错误或token", async () => {
        const { plan, options, root, verify } = fixture();
        options.download.mockRejectedValue(new Error("SYNTHETIC_INSTALL_SECRET"));
        const installer = new GenerationInstaller(options);
        const result = await installer.install("failed", plan, {
            token: "SYNTHETIC_INSTALL_SECRET",
        });
        expect(result.phase).toBe("failed");
        expect(verify).not.toHaveBeenCalled();
        expect(fs.readFileSync(path.join(root, "operations/failed.json"), "utf8")).not.toContain(
            "SYNTHETIC",
        );
        expect(() => options.store.readVerified(result.candidateId!)).toThrow();
    });

    it("验证失败不生成收据，也不重用失败候选", async () => {
        const { plan, options, download, verify } = fixture();
        verify.mockRejectedValue(new Error("plugin load failed"));
        const installer = new GenerationInstaller(options);
        const failed = await installer.install("verify-failure", plan);
        expect(failed.phase).toBe("failed");
        expect(() => options.store.readVerified(failed.candidateId!)).toThrow();
        await installer.install("verify-failure", plan);
        expect(download).toHaveBeenCalledTimes(1);
        const retry = await installer.install("new-request", plan);
        expect(retry.candidateId).not.toBe(failed.candidateId);
    });

    it("冷启动标记中断而不重新执行下载，保留候选", async () => {
        const { plan, options, download } = fixture();
        const onOperation = vi.fn();
        fs.mkdirSync(options.operationsDirectory);
        const candidate = options.store.allocate("crashed", plan.digest);
        fs.writeFileSync(
            path.join(options.operationsDirectory, "crashed.json"),
            JSON.stringify({
                schemaVersion: 1,
                id: "crashed",
                planDigest: plan.digest,
                phase: "downloading",
                candidateId: candidate.id,
                createdAt: new Date().toISOString(),
            }),
        );
        const installer = new GenerationInstaller({ ...options, onOperation });
        expect((await installer.install("crashed", plan)).phase).toBe("interrupted");
        expect(onOperation).toHaveBeenCalledWith(
            expect.objectContaining({ id: "crashed", status: "interrupted" }),
        );
        expect(download).not.toHaveBeenCalled();
        expect(fs.existsSync(candidate.directory)).toBe(true);
    });

    it("计划被篡改及幂等键复用在任何下载前拒绝", async () => {
        const { plan, options, download } = fixture();
        const installer = new GenerationInstaller(options);
        const changed = structuredClone(plan);
        changed.manifest.dependencies.onebots = "latest";
        expect(() => installer.install("bad", changed)).toThrow();
        expect(download).not.toHaveBeenCalled();
        await installer.install("same", plan);
        const other = createGenerationPlan({
            ...plan,
            host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
        });
        expect(() => installer.install("same", other)).toThrow();
        expect(download).toHaveBeenCalledTimes(1);
    });

    it("取消排队操作不会下载，关闭后拒绝新请求", async () => {
        const { plan, options, download } = fixture();
        const installer = new GenerationInstaller(options);
        const abort = new AbortController();
        abort.abort();
        expect((await installer.install("cancelled", plan, { signal: abort.signal })).phase).toBe(
            "failed",
        );
        expect(download).not.toHaveBeenCalled();
        await installer.close();
        await expect(installer.install("closed", plan)).rejects.toThrow();
    });
});
