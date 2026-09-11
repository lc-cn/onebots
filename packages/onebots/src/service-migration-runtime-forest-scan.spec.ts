import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanLegacyRuntimeForest } from "./service-migration-runtime-forest-scan.js";
import { scanRuntimeTree } from "./service-migration-runtime-tree-scan.js";

const cleanup: string[] = [];
afterEach(() => {
    for (const root of cleanup.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const base = fs.realpathSync(fs.mkdtempSync("/tmp/legacy-forest-"));
    cleanup.push(base);
    const roots = ["global", "workspace"].map(name => {
        const source = path.join(base, name);
        fs.mkdirSync(source, { mode: 0o750 });
        return { source, excludedPaths: [] as string[] };
    });
    return { base, roots, global: roots[0]!.source, workspace: roots[1]!.source };
}
const virtual = (absolute: string) => `fs/${absolute.slice(1)}`;

describe.skipIf(process.platform === "win32")("旧运行多根路径镜像扫描", () => {
    it("跨根链接保留单份模块，镜像可由原有扫描器重新验证", async () => {
        const test = fixture();
        fs.writeFileSync(path.join(test.global, "module.js"), "export const singleton = {};", {
            mode: 0o600,
        });
        fs.symlinkSync(
            path.join(test.global, "module.js"),
            path.join(test.workspace, "absolute.js"),
        );
        fs.symlinkSync("../global/module.js", path.join(test.workspace, "relative.js"));
        const result = await scanLegacyRuntimeForest(test.roots);
        expect(result.files.size).toBe(1);
        for (const name of ["absolute.js", "relative.js"])
            expect(result.entries).toContainEqual({
                path: virtual(path.join(test.workspace, name)),
                type: "link",
                target: "../global/module.js",
            });
        expect(result.entries).toContainEqual({
            path: virtual(test.global),
            type: "directory",
            mode: 0o750,
        });
        expect(result.entries).toContainEqual({
            path: virtual(test.base),
            type: "directory",
            mode: 0o700,
        });
        const copy = path.join(test.base, "copy");
        fs.mkdirSync(copy, { mode: 0o700 });
        for (const entry of result.entries
            .filter(entry => entry.type === "directory")
            .sort((a, b) => a.path.length - b.path.length)) {
            fs.mkdirSync(path.join(copy, entry.path), { recursive: true, mode: entry.mode });
        }
        for (const entry of result.entries) {
            const target = path.join(copy, entry.path);
            if (entry.type === "file") fs.copyFileSync(result.files.get(entry.path)!, target);
            if (entry.type === "link") fs.symlinkSync(entry.target, target);
        }
        for (const root of test.roots) fs.rmSync(root.source, { recursive: true });
        expect(await scanRuntimeTree(copy, true)).toEqual(result.entries);
    });
    it("不访问被排除的数据，仍拒绝指向它的程序链接", async () => {
        const test = fixture();
        const data = path.join(test.workspace, "data");
        fs.mkdirSync(data);
        fs.symlinkSync("/missing/private", path.join(data, "unsafe"));
        fs.writeFileSync(path.join(data, "secret"), "private");
        test.roots[1]!.excludedPaths = ["data"];
        expect(
            (await scanLegacyRuntimeForest(test.roots)).entries.some(entry =>
                entry.path.includes("/data"),
            ),
        ).toBe(false);
        fs.symlinkSync(path.join(data, "secret"), path.join(test.global, "leak"));
        await expect(scanLegacyRuntimeForest(test.roots)).rejects.toThrow();
    });
    it.each(["outside", "missing", "real-escape"])("拒绝 %s 链接", async kind => {
        const test = fixture();
        const outside = path.join(test.base, "outside");
        fs.writeFileSync(outside, "outside");
        if (kind === "real-escape") fs.symlinkSync(outside, path.join(test.workspace, "indirect"));
        fs.symlinkSync(
            kind === "outside"
                ? outside
                : kind === "missing"
                  ? path.join(test.global, "missing")
                  : path.join(test.workspace, "indirect"),
            path.join(test.global, "link"),
        );
        await expect(scanLegacyRuntimeForest(test.roots)).rejects.toThrow();
    });
    it("拒绝通过未选择根的链接绕回所选根", async () => {
        const test = fixture();
        fs.writeFileSync(path.join(test.workspace, "inside"), "inside");
        const alias = path.join(test.base, "alias");
        fs.symlinkSync(test.workspace, alias);
        fs.symlinkSync(path.join(alias, "inside"), path.join(test.global, "link"));
        await expect(scanLegacyRuntimeForest(test.roots)).rejects.toThrow();
    });
    it("拒绝空集合、重复、重叠、非规范根和超量根", async () => {
        const test = fixture();
        for (const roots of [
            [],
            [test.roots[0]!, test.roots[0]!],
            [...test.roots, { source: test.base, excludedPaths: [] }],
            [{ source: `${test.global}/`, excludedPaths: [] }],
            [{ source: "/", excludedPaths: [] }],
            Array(129).fill(test.roots[0]),
        ])
            await expect(scanLegacyRuntimeForest(roots)).rejects.toThrow();
    });
});
