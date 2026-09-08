import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
    ControlInstallationService,
    type ControlInstallationOptions,
} from "./installation-service.js";
import { GenerationStore, type VerifiedGeneration } from "../installation/generation-store.js";
import { GenerationInstaller } from "../installation/generation-installer.js";
import { createGenerationPlan } from "../installation/generation-plan.js";
import type { ResolvedRelease } from "../installation/release-resolver.js";

const folders: string[] = [];
const services: ControlInstallationService[] = [];
afterEach(async () => {
    for (const service of services.splice(0)) await service.close();
    vi.restoreAllMocks();
    for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
const empty = { adapters: [], protocols: [], applications: [] };
const revision = "a".repeat(64);
const expected = { generationId: null, configRevision: revision };
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ob-update-service-"));
    folders.push(directory);
    const state = {
        generationId: null as string | null,
        configRevision: revision,
        selection: structuredClone(empty),
    };
    const release: ResolvedRelease = {
        host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
        core: { name: "@onebots/core", version: "1.0.1", spec: "1.0.1" },
        extensionVersions: { "@onebots/adapter-mock": "1.0.2" },
        archiveSha256: "b".repeat(64),
    };
    const store = new GenerationStore({
        root: path.join(directory, "generations"),
        isActive: () => false,
    });
    const resolver = {
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        fetchMetadata: vi.fn(async (name: string, version: string) => ({
            name,
            version,
            peerDependencies: { "required-peer": "^1.0.0" },
        })),
    };
    const lifecycle = {
        activate: vi.fn(async () => {
            throw new Error("activation-observed");
        }),
    };
    const options: ControlInstallationOptions = {
        directory,
        store,
        resolver,
        lifecycle,
        currentGenerationId: () => state.generationId,
        currentConfigurationRevision: () => state.configRevision,
        currentSelection: () => state.selection,
        resolveRelease: vi.fn(async () => release),
    };
    const reopen = () => {
        const service = new ControlInstallationService(options);
        services.push(service);
        return service;
    };
    const service = reopen();
    const active = () => {
        const plan = createGenerationPlan({
            ...resolver,
            selection: { ...empty, adapters: ["mock"], applications: ["zhin"] },
            builtinApplications: ["zhin"],
            extensions: [
                {
                    type: "adapter",
                    name: "mock",
                    packageName: "@onebots/adapter-mock",
                    version: "1.0.1",
                    spec: "1.0.1",
                    peerDependencies: {},
                },
            ],
        });
        const location = path.join(directory, "active");
        fs.mkdirSync(location);
        fs.writeFileSync(path.join(location, "plan.json"), JSON.stringify(plan));
        const generation = {
            id: "active",
            directory: location,
            planDigest: plan.digest,
        } as VerifiedGeneration;
        vi.spyOn(store, "readVerified").mockReturnValue(generation);
        state.generationId = "active";
        return plan;
    };
    return {
        directory,
        state,
        release,
        store,
        resolver,
        lifecycle,
        options,
        service,
        reopen,
        active,
    };
}
function fakeInstaller(directory: string) {
    const install = vi
        .spyOn(GenerationInstaller.prototype, "install")
        .mockImplementation(async (id, plan) => {
            const operation = {
                schemaVersion: 1 as const,
                id,
                phase: "verified" as const,
                planDigest: plan.digest,
                candidateId: "candidate",
                createdAt: new Date().toISOString(),
            };
            fs.writeFileSync(
                path.join(directory, "installations", `${id}.json`),
                JSON.stringify(operation),
            );
            return operation;
        });
    vi.spyOn(GenerationInstaller.prototype, "status").mockImplementation(id =>
        JSON.parse(fs.readFileSync(path.join(directory, "installations", `${id}.json`), "utf8")),
    );
    return install;
}
it("bundled空安装生成升级确认并跨重启保持相同ID，不声称升级已执行", async () => {
    const f = fixture();
    const result = await f.service.planUpdate(expected);
    expect(result).toMatchObject({
        state: "updates_available",
        base: expected,
        packages: [
            { name: "onebots", current: "1.2.12", target: "1.2.13" },
            { name: "@onebots/core", current: "1.0.0", target: "1.0.1" },
        ],
    });
    expect(result.installationPlan?.selection).toEqual(empty);
    expect(await f.reopen().planUpdate(expected)).toEqual(result);
    expect(f.lifecycle.activate).not.toHaveBeenCalled();
    const saved = JSON.parse(
        fs.readFileSync(
            path.join(f.directory, "plans", `${result.installationPlan!.id}.json`),
            "utf8",
        ),
    );
    expect(saved.update).toEqual({
        configRevision: revision,
        archiveSha256: f.release.archiveSha256,
    });
});
it("从活动验证收据保留未启用adapter及框架，不从空配置缩减已安装清单", async () => {
    const f = fixture();
    const active = f.active();
    const result = await f.service.planUpdate({ ...expected, generationId: "active" });
    expect(result.installationPlan?.selection).toEqual(active.selection);
    expect(result.packages).toContainEqual({
        name: "@onebots/adapter-mock",
        current: "1.0.1",
        target: "1.0.2",
    });
    expect(result.peers).toContainEqual({
        requestedBy: "@onebots/adapter-mock",
        packageName: "required-peer",
        range: "^1.0.0",
    });
    expect(result.packages.some(item => item.name === "required-peer")).toBe(false);
    expect(result.recommendations).toHaveLength(1);
});
it("无法确认bundled完整空清单时拒绝，不能漏掉启用依赖", async () => {
    const f = fixture();
    f.state.selection.adapters.push("mock");
    await expect(f.service.planUpdate(expected)).rejects.toThrow("完整安装收据");
    f.options.currentSelection = undefined;
    await expect(f.service.planUpdate(expected)).rejects.toThrow("完整安装收据");
    expect(f.options.resolveRelease).not.toHaveBeenCalled();
});
it("完整精确组合相同返回current，没有安装确认", async () => {
    const f = fixture();
    f.release.host = { ...f.resolver.host };
    f.release.core = { ...f.resolver.core };
    expect(await f.service.planUpdate(expected)).toMatchObject({ state: "current" });
    expect(await f.service.planUpdate(expected)).not.toHaveProperty("installationPlan");
    expect(fs.readdirSync(path.join(f.directory, "plans"))).toEqual([]);
});
it("拒绝较旧latest与相同host的不一致发布组合", async () => {
    const f = fixture();
    f.release.host = { name: "onebots", version: "1.2.11", spec: "1.2.11" };
    await expect(f.service.planUpdate(expected)).rejects.toThrow("拒绝降级");
    f.release.host = { ...f.resolver.host };
    await expect(f.service.planUpdate(expected)).rejects.toThrow("组合不一致");
});
it.each(["generation", "configuration"])("release异步解析中%s变化不保存陈旧计划", async kind => {
    const f = fixture();
    f.options.resolveRelease = async () => {
        if (kind === "generation") f.state.generationId = "changed";
        else f.state.configRevision = "c".repeat(64);
        return f.release;
    };
    await expect(f.service.planUpdate(expected)).rejects.toThrow("变化");
    expect(fs.readdirSync(path.join(f.directory, "plans"))).toEqual([]);
});
it("扩展metadata解析中配置变化也不保存计划", async () => {
    const f = fixture();
    f.active();
    f.resolver.fetchMetadata.mockImplementation(async (name, version) => {
        f.state.configRevision = "c".repeat(64);
        return { name, version, peerDependencies: {} };
    });
    await expect(f.service.planUpdate({ ...expected, generationId: "active" })).rejects.toThrow(
        "配置已发生变化",
    );
    expect(fs.readdirSync(path.join(f.directory, "plans"))).toEqual([]);
});
it("配置修订和已验证archive摘要都参与确认ID而非仅planDigest", async () => {
    const f = fixture();
    const first = await f.service.planUpdate(expected);
    f.release.archiveSha256 = "c".repeat(64);
    const second = await f.service.planUpdate(expected);
    f.state.configRevision = "d".repeat(64);
    const third = await f.service.planUpdate({
        ...expected,
        configRevision: f.state.configRevision,
    });
    expect(new Set([first, second, third].map(item => item.installationPlan!.id)).size).toBe(3);
    expect(
        new Set([first, second, third].map(item => item.installationPlan!.planDigest)).size,
    ).toBe(1);
});
it("新安装重查配置，旧操作只读回执不重派；激活仍携带原确认配置", async () => {
    const f = fixture();
    const result = await f.service.planUpdate(expected);
    const plan = result.installationPlan!;
    const install = fakeInstaller(f.directory);
    const request = { id: "upgrade", planId: plan.id };
    f.state.configRevision = "c".repeat(64);
    expect(() => f.service.install(request, false)).toThrow("配置已发生变化");
    expect(install).not.toHaveBeenCalled();
    f.state.configRevision = revision;
    const receipt = f.service.install(request, false);
    f.state.configRevision = "c".repeat(64);
    f.state.generationId = "new-active";
    expect(f.reopen().install(request, false)).toEqual(receipt);
    expect(install).toHaveBeenCalledTimes(1);
    vi.spyOn(f.store, "readVerified").mockReturnValue({
        id: "candidate",
        operationId: "upgrade",
        planDigest: plan.planDigest,
    } as VerifiedGeneration);
    await expect(f.service.activate("candidate")).rejects.toThrow("activation-observed");
    expect(f.lifecycle.activate).toHaveBeenCalledExactlyOnceWith("candidate", null, revision);
});
it("已有binding但操作记录缺失绝不重派，修改确认也无法解除配置约束", async () => {
    const f = fixture();
    const result = await f.service.planUpdate(expected);
    const plan = result.installationPlan!;
    const install = fakeInstaller(f.directory);
    const request = { id: "upgrade", planId: plan.id };
    f.service.install(request, false);
    fs.rmSync(path.join(f.directory, "installations/upgrade.json"));
    expect(() => f.reopen().install(request, false)).toThrow("禁止重新派发");
    expect(install).toHaveBeenCalledTimes(1);
    const filename = path.join(f.directory, "plans", `${plan.id}.json`);
    const record = JSON.parse(fs.readFileSync(filename, "utf8"));
    delete record.update;
    fs.writeFileSync(filename, JSON.stringify(record));
    expect(() => f.service.install({ id: "another", planId: plan.id }, false)).toThrow("重新确认");
});
it("普通安装计划不绑定配置修订", async () => {
    const f = fixture();
    const plan = await f.service.plan(empty, null);
    const install = fakeInstaller(f.directory);
    f.state.configRevision = "c".repeat(64);
    expect(f.service.install({ id: "ordinary", planId: plan.id }, false).phase).toBe("verified");
    expect(install).toHaveBeenCalledTimes(1);
});

it("关闭期间完成的异步发布解析不能落盘确认", async () => {
    const f = fixture();
    let release!: (value: ResolvedRelease) => void;
    f.options.resolveRelease = () =>
        new Promise(resolve => {
            release = resolve;
        });
    const pending = f.service.planUpdate(expected);
    await f.service.close();
    release(f.release);
    await expect(pending).rejects.toThrow("关闭");
    expect(fs.readdirSync(path.join(f.directory, "plans"))).toEqual([]);
});
it("缺失配置快照或初始双基线陈旧时不访问公开源", async () => {
    const f = fixture();
    await expect(f.service.planUpdate({ ...expected, generationId: "wrong" })).rejects.toThrow(
        "变化",
    );
    await expect(f.service.planUpdate({ ...expected, configRevision: "wrong" })).rejects.toThrow(
        "变化",
    );
    f.options.currentConfigurationRevision = undefined;
    await expect(f.service.planUpdate(expected)).rejects.toThrow("变化");
    expect(f.options.resolveRelease).not.toHaveBeenCalled();
});
it("调用方修改原expected对象不能篡改正在解析的确认基线", async () => {
    const f = fixture();
    const mutable = { ...expected };
    f.options.resolveRelease = async () => {
        mutable.configRevision = "c".repeat(64);
        return f.release;
    };
    const result = await f.service.planUpdate(mutable);
    expect(result.base).toEqual(expected);
    const saved = JSON.parse(
        fs.readFileSync(
            path.join(f.directory, "plans", `${result.installationPlan!.id}.json`),
            "utf8",
        ),
    );
    expect(saved.update.configRevision).toBe(revision);
});
it("相同操作ID不能借另一份相同planDigest确认替换原配置绑定", async () => {
    const f = fixture();
    const first = (await f.service.planUpdate(expected)).installationPlan!;
    const install = fakeInstaller(f.directory);
    f.service.install({ id: "upgrade", planId: first.id }, false);
    f.state.configRevision = "c".repeat(64);
    const next = (
        await f.service.planUpdate({ ...expected, configRevision: f.state.configRevision })
    ).installationPlan!;
    expect(next.planDigest).toBe(first.planDigest);
    expect(() => f.service.install({ id: "upgrade", planId: next.id }, false)).toThrow("其他计划");
    expect(install).toHaveBeenCalledTimes(1);
});
