import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { discoverLegacyRuntimeLayout } from "./service-migration-runtime-layout.js";
import type { ServiceSpec } from "./service-definition.js";

const temporary: string[] = [];
afterEach(async () => {
    for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "onebots-layout-")));
    temporary.push(root);
    const cwd = path.join(root, "workspace");
    await mkdir(cwd);
    const spec: ServiceSpec = {
        scope: "user",
        workingDirectory: cwd,
        configPath: path.join(cwd, "config.yaml"),
        adapters: ["mock"],
        protocols: [],
        nodePath: process.execPath,
        binPath: "",
    };
    const pkg = async (directory: string, name: string, dependencies = {}) => {
        await mkdir(directory, { recursive: true });
        await writeFile(
            path.join(directory, "package.json"),
            JSON.stringify({ name, dependencies }),
        );
        return directory;
    };
    return { root, cwd, spec, pkg };
}
describe.skipIf(process.platform === "win32")("旧运行目录发现", () => {
    it("全局 npm 包只选择依赖包，不扫描无关全局包，并排除账号数据", async () => {
        const { root, cwd, spec, pkg } = await fixture();
        const modules = path.join(root, "global/node_modules");
        const host = await pkg(path.join(modules, "onebots"), "onebots", { "@onebots/core": "1" });
        const core = await pkg(path.join(modules, "@onebots/core"), "@onebots/core");
        await pkg(path.join(modules, "unrelated"), "unrelated");
        await pkg(path.join(cwd, "node_modules/@onebots/adapter-mock"), "@onebots/adapter-mock");
        spec.binPath = path.join(host, "bin.js");
        await writeFile(spec.binPath, "");
        await mkdir(path.join(cwd, "data"));
        await writeFile(spec.configPath, "secret");
        const roots = await discoverLegacyRuntimeLayout(spec);
        expect(roots.map(item => item.source).sort()).toEqual([cwd, host, core].sort());
        expect(roots.find(item => item.source === cwd)?.excludedPaths).toEqual([
            "config.yaml",
            "data",
            ".control",
        ]);
    });
    it("pnpm 虚拟槽保留依赖别名和跨槽链接", async () => {
        const { root, cwd, spec, pkg } = await fixture();
        const store = path.join(root, "global/node_modules/.pnpm");
        const slot = path.join(store, "onebots@1/node_modules");
        const host = await pkg(path.join(slot, "onebots"), "onebots", { "@onebots/core": "1" });
        const core = await pkg(
            path.join(store, "core@1/node_modules/@onebots/core"),
            "@onebots/core",
        );
        await mkdir(path.join(slot, "@onebots"));
        await symlink(
            path.relative(path.join(slot, "@onebots"), core),
            path.join(slot, "@onebots/core"),
        );
        await pkg(path.join(cwd, "node_modules/@onebots/adapter-mock"), "@onebots/adapter-mock");
        spec.binPath = path.join(host, "bin.js");
        await writeFile(spec.binPath, "");
        const roots = await discoverLegacyRuntimeLayout(spec);
        expect(roots.map(item => item.source)).toContain(slot);
        expect(roots.map(item => item.source)).toContain(path.join(store, "core@1/node_modules"));
        expect(roots.map(item => item.source)).not.toContain(store);
    });
    it("拒绝插件解析到另一份核心", async () => {
        const { root, cwd, spec, pkg } = await fixture();
        const host = await pkg(path.join(root, "global/onebots"), "onebots", {
            "@onebots/core": "1",
        });
        await pkg(path.join(host, "node_modules/@onebots/core"), "@onebots/core");
        const plugin = await pkg(
            path.join(cwd, "node_modules/@onebots/adapter-mock"),
            "@onebots/adapter-mock",
        );
        await pkg(path.join(plugin, "node_modules/@onebots/core"), "@onebots/core");
        spec.binPath = path.join(host, "bin.js");
        await writeFile(spec.binPath, "");
        await expect(discoverLegacyRuntimeLayout(spec)).rejects.toThrow("禁止自动切换");
    });
    it("保留工作区父级依赖并拒绝未声明外部文件链接", async () => {
        const { root, cwd, spec, pkg } = await fixture();
        const host = await pkg(path.join(root, "host"), "onebots", { "@onebots/core": "1" });
        await pkg(path.join(host, "node_modules/@onebots/core"), "@onebots/core");
        const dependency = await pkg(path.join(root, "node_modules/shared"), "shared");
        await pkg(path.join(cwd, "node_modules/@onebots/adapter-mock"), "@onebots/adapter-mock", {
            shared: "1",
        });
        spec.binPath = path.join(host, "bin.js");
        await writeFile(spec.binPath, "");
        expect((await discoverLegacyRuntimeLayout(spec)).map(item => item.source)).toContain(
            dependency,
        );
        const outside = path.join(root, "outside.txt");
        await writeFile(outside, "not a dependency");
        await symlink(outside, path.join(host, "external"));
        await expect(discoverLegacyRuntimeLayout(spec)).rejects.toThrow("禁止自动切换");
    });
});
