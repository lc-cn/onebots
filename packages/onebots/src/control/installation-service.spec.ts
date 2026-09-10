import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerationPlan } from "../installation/generation-plan.js";
import { GenerationInstaller } from "../installation/generation-installer.js";
import { GenerationStore } from "../installation/generation-store.js";
import { ControlInstallationService } from "./installation-service.js";

vi.mock("node:fs", async original => {
    const actual = await original<typeof import("node:fs")>();
    return { ...actual, default: { ...actual, renameSync: vi.fn(actual.renameSync) } };
});
const folders: string[] = [];
const services: ControlInstallationService[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    for (const service of services.splice(0)) await service.close();
    for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-install-service-"));
    folders.push(directory);
    const artifact = Buffer.from("synthetic tarball bytes for planning only");
    fs.writeFileSync(path.join(directory, "host.tgz"), artifact);
    const store = new GenerationStore({
        root: path.join(directory, "generations"),
        isActive: () => false,
    });
    const resolver = {
        host: {
            name: "onebots",
            version: "1.2.12",
            spec: `file:${directory}/host.tgz`,
            sha256: createHash("sha256").update(artifact).digest("hex"),
        },
        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        fetchMetadata: vi.fn(async () => {
            throw new Error("metadata should not be requested");
        }),
    };
    let active: string | null = null;
    let selection = {
        adapters: [] as string[],
        protocols: [] as string[],
        applications: [] as string[],
    };
    let configRevision = "a".repeat(64);
    let document: Record<string, unknown> = {
        plugins: { adapters: [], protocols: [], applications: [] },
    };
    const options = {
        currentGenerationId: () => active,
        currentSelection: () => structuredClone(selection),
        currentConfigurationRevision: () => configRevision,
        currentConfiguration: () => ({
            revision: configRevision,
            document: structuredClone(document),
        }),
        directory,
        store,
        resolver,
        lifecycle: {
            activate: vi.fn(async () => {
                throw new Error("synthetic-secret");
            }),
        },
    };
    const reopen = () => {
        const service = new ControlInstallationService(options);
        services.push(service);
        return service;
    };
    return {
        directory,
        store,
        lifecycle: options.lifecycle,
        service: reopen(),
        reopen,
        resolver,
        setActive: (id: string | null) => {
            active = id;
            if (id !== null) {
                const location = path.join(directory, id);
                fs.mkdirSync(path.join(location, "node_modules/onebots/lib"), { recursive: true });
                const plan = createGenerationPlan({
                    ...resolver,
                    selection: { adapters: [], protocols: [], applications: [] },
                    extensions: [],
                });
                fs.writeFileSync(path.join(location, "plan.json"), JSON.stringify(plan));
                fs.writeFileSync(
                    path.join(location, "node_modules/onebots/package.json"),
                    JSON.stringify({
                        name: "onebots",
                        version: resolver.host.version,
                        dependencies: { "@onebots/core": resolver.core.version },
                    }),
                );
                fs.writeFileSync(
                    path.join(
                        location,
                        "node_modules/onebots/lib/extension-capability-catalog.json",
                    ),
                    JSON.stringify({
                        schemaVersion: 2,
                        packages: { "@onebots/adapter-mock": { version: "1.0.0" } },
                    }),
                );
                vi.spyOn(store, "readVerified").mockReturnValue({
                    id,
                    directory: location,
                    planDigest: plan.digest,
                } as ReturnType<typeof store.readVerified>);
            }
        },
        setSelection: (value: typeof selection) => {
            selection = structuredClone(value);
        },
        setConfiguration: (value: Record<string, unknown>, revision = "b".repeat(64)) => {
            document = structuredClone(value);
            configRevision = revision;
        },
    };
}

const empty = { adapters: [], protocols: [], applications: [] };

describe("control installation service", () => {
    it("两个客户端计划绑定原版本，陈旧确认不能安装，重新确认生成不同ID", async () => {
        const test = fixture();
        const a = await test.service.plan(empty, null);
        const b = await test.service.plan(empty, null);
        expect(a.id).toBe(b.id);
        test.setActive("new-active");
        await expect(test.service.plan(empty, null)).rejects.toThrow("运行版本已变化");
        expect(() => test.service.install({ id: "client-b", planId: b.id }, false)).toThrow(
            "运行版本已变化",
        );
        const fresh = await test.service.plan(empty, "new-active");
        expect(fresh.id).not.toBe(a.id);
        expect(fresh.planDigest).toBe(a.planDigest);
        expect(fs.readdirSync(path.join(test.directory, "installations"))).toEqual([]);
    });
    it("候选应用只使用原操作持久化base，不能借其他客户端新确认解除旧base", async () => {
        const test = fixture();
        const plan = await test.service.plan(empty, null);
        fs.rmSync(path.join(test.directory, "artifacts", `${test.resolver.host.sha256}.tgz`));
        test.service.install({ id: "original", planId: plan.id }, false);
        await test.service.close();
        const service = test.reopen();
        test.setActive("new-active");
        await service.plan(empty, "new-active");
        vi.spyOn(test.store, "readVerified").mockReturnValue({
            id: "candidate",
            operationId: "original",
            planDigest: plan.planDigest,
        } as ReturnType<typeof test.store.readVerified>);
        vi.spyOn(GenerationInstaller.prototype, "status").mockReturnValue({
            schemaVersion: 1,
            id: "original",
            planDigest: plan.planDigest,
            candidateId: "candidate",
            phase: "verified",
            createdAt: new Date().toISOString(),
        });
        await expect(service.activate("candidate")).rejects.toThrow("synthetic-secret");
        expect(test.lifecycle.activate).toHaveBeenCalledWith("candidate", null);
        vi.mocked(test.store.readVerified).mockReturnValue({
            id: "unbound",
            operationId: "unknown",
            planDigest: plan.planDigest,
        } as ReturnType<typeof test.store.readVerified>);
        expect(() => service.activate("unbound")).toThrow();
        expect(test.lifecycle.activate).toHaveBeenCalledTimes(1);
    });
    it("异步解析期间另一客户端应用后不能落盘陈旧计划", async () => {
        const test = fixture();
        const pending = test.service.plan(empty, null);
        test.setActive("new-active");
        await expect(pending).rejects.toThrow("运行版本已变化");
        expect(fs.readdirSync(path.join(test.directory, "plans"))).toEqual([]);
    });
    it("无账号即可只读查看目录，不加载或下载扩展，返回值不可污染目录", () => {
        const test = fixture();
        const before = fs.readdirSync(test.directory).sort();
        const catalog = test.service.catalog();
        expect(catalog.adapters.find(entry => entry.name === "matrix")?.version).toMatch(
            /^\d+\.\d+\.\d+/,
        );
        expect(catalog.protocols.some(entry => entry.name === "onebot-v11")).toBe(true);
        expect(catalog.applications.some(entry => entry.name === "zhin")).toBe(true);
        catalog.adapters.length = 0;
        catalog.applications[0].displayName = "changed";
        expect(test.service.catalog().adapters.length).toBeGreaterThan(0);
        expect(test.service.catalog().applications[0].displayName).not.toBe("changed");
        expect(fs.readdirSync(test.directory).sort()).toEqual(before);
        expect(fs.existsSync(path.join(test.directory, "config.yaml"))).toBe(false);
        expect(test.resolver.fetchMetadata).not.toHaveBeenCalled();
    });

    it("计划原子私有持久化且重复/重启返回同一计划，框架不补协议", async () => {
        const test = fixture();
        const selection = { ...empty, applications: ["zhin"] };
        const result = await test.service.plan(selection, null);
        expect(result.selection).toEqual(selection);
        expect(result.recommendations).toHaveLength(1);
        expect(JSON.stringify(result)).not.toContain("missing-host.tgz");
        expect(await test.service.plan(selection, null)).toEqual(result);
        await test.service.close();
        expect(await test.reopen().plan(selection, null)).toEqual(result);
        const plans = path.join(test.directory, "plans");
        expect(fs.readdirSync(plans)).toEqual([`${result.id}.json`]);
        if (process.platform !== "win32") {
            expect(fs.statSync(plans).mode & 0o777).toBe(0o700);
            expect(fs.statSync(path.join(plans, `${result.id}.json`)).mode & 0o777).toBe(0o600);
        }
    });

    it("移除先拒绝配置引用，再创建完整候选并绑定配置版本", async () => {
        const test = fixture();
        test.setSelection({ adapters: ["mock"], protocols: [], applications: ["zhin"] });
        test.setConfiguration({
            plugins: { adapters: ["mock"], protocols: [], applications: ["zhin"] },
            "mock.account": {},
        });
        await expect(
            test.service.plan({ adapters: [], protocols: [], applications: ["zhin"] }, null),
        ).rejects.toThrow("仍被当前配置引用");
        test.setConfiguration({
            plugins: { adapters: [], protocols: [], applications: ["zhin"] },
        });
        const plan = await test.service.plan(
            { adapters: [], protocols: [], applications: ["zhin"] },
            null,
        );
        expect(plan.selection).toEqual({ adapters: [], protocols: [], applications: ["zhin"] });
        expect(plan.removed).toEqual({ adapters: ["mock"], protocols: [], applications: [] });
        test.setConfiguration(
            { plugins: { adapters: [], protocols: [], applications: ["zhin"] } },
            "c".repeat(64),
        );
        expect(() => test.service.install({ id: "stale-removal", planId: plan.id }, false)).toThrow(
            "配置已发生变化",
        );
        expect(fs.readdirSync(path.join(test.directory, "installations"))).toEqual([]);
    });

    it("完整集合多选取消也走移除引用保护", async () => {
        const test = fixture();
        test.setSelection({ adapters: ["mock"], protocols: [], applications: [] });
        test.setConfiguration({
            plugins: { adapters: ["mock"], protocols: [], applications: [] },
        });
        await expect(test.service.plan(empty, null)).rejects.toThrow("仍被当前配置引用");
        expect(fs.readdirSync(path.join(test.directory, "plans"))).toEqual([]);
    });

    it("移除安装和激活复核同一配置快照，不接受计划多删扩展", async () => {
        const test = fixture();
        test.setSelection({ adapters: ["mock"], protocols: [], applications: ["zhin"] });
        test.setConfiguration({
            plugins: { adapters: [], protocols: [], applications: ["zhin"] },
        });
        const plan = await test.service.plan(
            { adapters: [], protocols: [], applications: ["zhin"] },
            null,
        );
        const queued = {
            schemaVersion: 1 as const,
            id: "remove-operation",
            planDigest: plan.planDigest,
            phase: "queued" as const,
            createdAt: new Date().toISOString(),
        };
        vi.spyOn(GenerationInstaller.prototype, "install").mockResolvedValue(queued);
        const status = vi.spyOn(GenerationInstaller.prototype, "status").mockReturnValue(queued);
        test.service.install({ id: queued.id, planId: plan.id }, false);
        const verified = {
            ...queued,
            phase: "verified" as const,
            candidateId: "candidate",
        };
        status.mockReturnValue(verified);
        vi.spyOn(test.store, "readVerified").mockReturnValue({
            id: "candidate",
            operationId: queued.id,
            planDigest: plan.planDigest,
        } as ReturnType<typeof test.store.readVerified>);
        await expect(test.service.activate("candidate")).rejects.toThrow("synthetic-secret");
        expect(test.lifecycle.activate).toHaveBeenCalledWith("candidate", null, "b".repeat(64));

        test.setSelection({
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            applications: ["zhin"],
        });
        expect(() =>
            test.reopen().install({ id: "changed-base-selection", planId: plan.id }, false),
        ).toThrow("移除计划与活动运行版本不一致");
    });

    it("计划rename中断不留下半成品，下次确认可正常完成并同步目录", async () => {
        const test = fixture();
        vi.mocked(fs.renameSync).mockImplementationOnce(() => {
            throw new Error("interrupted");
        });
        await expect(test.service.plan(empty, null)).rejects.toThrow("interrupted");
        expect(fs.readdirSync(path.join(test.directory, "plans"))).toEqual([]);
        let syncedDirectory = false;
        const actualSync = fs.fsyncSync;
        vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => {
            if (fs.fstatSync(descriptor).isDirectory()) syncedDirectory = true;
            actualSync(descriptor);
        });
        await test.service.plan(empty, null);
        if (process.platform !== "win32") expect(syncedDirectory).toBe(true);
    });

    it("真实installer在下载前失败仍记录状态，重复ID不重试且私有token不落盘", async () => {
        const test = fixture();
        const plan = await test.service.plan(empty, null);
        const request = { id: "install-1", planId: plan.id, token: "synthetic-secret" };
        fs.rmSync(path.join(test.directory, "artifacts", `${test.resolver.host.sha256}.tgz`));
        expect(() => test.service.install(request, false)).toThrow("受保护的传输");
        expect(fs.readdirSync(path.join(test.directory, "installations"))).toEqual([]);
        const dispatch = GenerationInstaller.prototype.install;
        const spy = vi
            .spyOn(GenerationInstaller.prototype, "install")
            .mockImplementation(function (id, input, options) {
                const binding = JSON.parse(
                    fs.readFileSync(
                        path.join(test.directory, "installation-bindings", `${id}.json`),
                        "utf8",
                    ),
                );
                expect(binding).toEqual({
                    planId: plan.id,
                    planDigest: plan.planDigest,
                    baseGenerationId: null,
                });
                return dispatch.call(this, id, input, options);
            });
        expect(test.service.install(request, true).phase).toBe("queued");
        expect(test.service.install(request, true).id).toBe("install-1");
        await test.service.close();
        const operation = test.service.status("install-1");
        expect(operation).toMatchObject({ phase: "failed", error: "ARTIFACT_INPUT_FAILED" });
        expect(JSON.stringify(operation)).not.toContain("synthetic-secret");
        const reopened = test.reopen();
        test.setActive("another-client-applied");
        expect(reopened.install(request, true)).toEqual(operation);
        expect(reopened.status("install-1")).toEqual(operation);
        expect(spy).toHaveBeenCalledTimes(1);
        test.setActive(null);
        const other = await reopened.plan({ ...empty, applications: ["zhin"] }, null);
        expect(() => reopened.install({ id: "install-1", planId: other.id }, false)).toThrow(
            "其他计划",
        );
        for (const folder of ["plans", "installations"])
            for (const file of fs.readdirSync(path.join(test.directory, folder))) {
                expect(
                    fs.readFileSync(path.join(test.directory, folder, file), "utf8"),
                ).not.toContain("synthetic-secret");
            }
    });

    it("损坏计划拒绝执行并隐藏磁盘内容，关闭后不再接受计划", async () => {
        const test = fixture();
        const plan = await test.service.plan(empty, null);
        fs.writeFileSync(
            path.join(test.directory, "plans", `${plan.id}.json`),
            "synthetic-secret-broken-json",
        );
        expect(() => test.service.install({ id: "install-1", planId: plan.id }, false)).toThrow(
            /^安装计划不可读取或已变化，请重新确认$/,
        );
        await test.service.close();
        await expect(test.service.plan(empty, null)).rejects.toThrow("关闭");
    });
});
