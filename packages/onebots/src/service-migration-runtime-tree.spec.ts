import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
    captureLegacyRuntimeTree,
    verifyLegacyRuntimeTree,
} from "./service-migration-runtime-tree.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/legacy-runtime-tree-"));
    roots.push(root);
    const source = path.join(root, "source");
    const store = path.join(root, "store");
    fs.mkdirSync(source, { mode: 0o700 });
    fs.mkdirSync(store, { mode: 0o700 });
    const id = randomUUID();
    const write = (relative: string, content: string, mode = 0o600) => {
        const file = path.join(source, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, content, { mode });
        return file;
    };
    write("package.json", JSON.stringify({ type: "module" }));
    write("bin.js", 'import { answer } from "legacy-dep"; process.stdout.write(answer);\n');
    return { root, source, store, id, write };
}

function npmFixture() {
    const test = fixture();
    test.write(
        "node_modules/legacy-dep/package.json",
        JSON.stringify({
            name: "legacy-dep",
            type: "module",
            exports: "./index.js",
        }),
    );
    test.write("node_modules/legacy-dep/index.js", 'export const answer = "old-npm-runtime-42";\n');
    return test;
}

describe.skipIf(process.platform === "win32")("旧运行目录完整快照", () => {
    it("保留 npm 依赖闭包，源目录删除后仍运行旧程序", async () => {
        const test = npmFixture();
        test.write("assets/empty.txt", "");
        fs.mkdirSync(path.join(test.source, "empty-directory"), { mode: 0o750 });
        fs.chmodSync(path.join(test.source, "bin.js"), 0o750);
        const receipt = await captureLegacyRuntimeTree(test.source, test.store, test.id);
        expect(receipt).toMatchObject({
            schemaVersion: 1,
            id: test.id,
            root: path.join(test.store, test.id, "runtime"),
        });
        expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/);
        expect(fs.statSync(path.join(receipt.root, "bin.js")).mode & 0o777).toBe(0o750);
        expect(fs.statSync(path.join(receipt.root, "empty-directory")).isDirectory()).toBe(true);
        fs.rmSync(test.source, { recursive: true });
        await verifyLegacyRuntimeTree(receipt);
        expect(
            execFileSync(process.execPath, [path.join(receipt.root, "bin.js")], {
                encoding: "utf8",
                env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
            }),
        ).toBe("old-npm-runtime-42");
    });

    it("保留 pnpm 内部符号链接与传递依赖，绝对内部链接转相对链接", async () => {
        const test = fixture();
        const dep = "node_modules/.pnpm/legacy-dep@1.0.0/node_modules/legacy-dep";
        const leaf = "node_modules/.pnpm/legacy-leaf@1.0.0/node_modules/legacy-leaf";
        test.write(
            `${dep}/package.json`,
            JSON.stringify({
                name: "legacy-dep",
                type: "module",
                exports: "./index.js",
            }),
        );
        test.write(
            `${dep}/index.js`,
            'import { value } from "legacy-leaf"; export const answer = `old-pnpm-${value}`;\n',
        );
        test.write(
            `${leaf}/package.json`,
            JSON.stringify({
                name: "legacy-leaf",
                type: "module",
                exports: "./index.js",
            }),
        );
        test.write(`${leaf}/index.js`, 'export const value = "transitive-37";\n');
        fs.symlinkSync(
            ".pnpm/legacy-dep@1.0.0/node_modules/legacy-dep",
            path.join(test.source, "node_modules/legacy-dep"),
        );
        fs.symlinkSync(
            path.join(test.source, leaf),
            path.join(test.source, path.dirname(dep), "legacy-leaf"),
        );
        const receipt = await captureLegacyRuntimeTree(test.source, test.store, test.id);
        expect(fs.readlinkSync(path.join(receipt.root, "node_modules/legacy-dep"))).toBe(
            ".pnpm/legacy-dep@1.0.0/node_modules/legacy-dep",
        );
        const converted = fs.readlinkSync(
            path.join(receipt.root, path.dirname(dep), "legacy-leaf"),
        );
        expect(path.isAbsolute(converted)).toBe(false);
        fs.rmSync(test.source, { recursive: true });
        await verifyLegacyRuntimeTree(receipt);
        expect(
            execFileSync(process.execPath, [path.join(receipt.root, "bin.js")], {
                encoding: "utf8",
                env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
            }),
        ).toBe("old-pnpm-transitive-37");
    });

    it("源硬链接复制为独立文件，源内容改变不会污染快照", async () => {
        const test = npmFixture();
        const original = test.write("hardlink-original", "old-hardlink");
        fs.linkSync(original, path.join(test.source, "hardlink-alias"));
        const receipt = await captureLegacyRuntimeTree(test.source, test.store, test.id);
        const target = path.join(receipt.root, "hardlink-original");
        const alias = path.join(receipt.root, "hardlink-alias");
        expect(fs.statSync(target).nlink).toBe(1);
        expect(fs.statSync(alias).nlink).toBe(1);
        expect(fs.statSync(target).ino).not.toBe(fs.statSync(alias).ino);
        fs.writeFileSync(original, "changed-source");
        expect(fs.readFileSync(target, "utf8")).toBe("old-hardlink");
        await verifyLegacyRuntimeTree(receipt);
    });

    it.each([
        "add",
        "delete",
        "content",
        "file-mode",
        "directory-mode",
        "type",
        "link-target",
        "hardlink",
    ])("校验拒绝快照的 %s 篡改", async mutation => {
        const test = npmFixture();
        test.write("one", "same");
        test.write("two", "same");
        fs.symlinkSync("one", path.join(test.source, "link"));
        const receipt = await captureLegacyRuntimeTree(test.source, test.store, test.id);
        const one = path.join(receipt.root, "one");
        if (mutation === "add")
            fs.writeFileSync(path.join(receipt.root, "added"), "x", { mode: 0o600 });
        if (mutation === "delete") fs.unlinkSync(one);
        if (mutation === "content") fs.writeFileSync(one, "other");
        if (mutation === "file-mode") fs.chmodSync(one, 0o640);
        if (mutation === "directory-mode")
            fs.chmodSync(path.join(receipt.root, "node_modules"), 0o750);
        if (mutation === "type") {
            fs.unlinkSync(one);
            fs.mkdirSync(one, { mode: 0o700 });
        }
        if (mutation === "link-target") {
            fs.unlinkSync(path.join(receipt.root, "link"));
            fs.symlinkSync("two", path.join(receipt.root, "link"));
        }
        if (mutation === "hardlink") fs.linkSync(one, path.join(test.root, "external-hardlink"));
        await expect(verifyLegacyRuntimeTree(receipt)).rejects.toThrow();
    });

    it.each(["escape-relative", "escape-absolute", "broken", "cycle"])(
        "拒绝 %s 符号链接",
        async scenario => {
            const test = npmFixture();
            fs.writeFileSync(path.join(test.root, "outside"), "outside", { mode: 0o600 });
            const target =
                scenario === "escape-relative"
                    ? "../outside"
                    : scenario === "escape-absolute"
                      ? path.join(test.root, "outside")
                      : scenario === "broken"
                        ? "missing"
                        : "invalid-link";
            fs.symlinkSync(target, path.join(test.source, "invalid-link"));
            await expect(
                captureLegacyRuntimeTree(test.source, test.store, test.id),
            ).rejects.toThrow();
        },
    );

    it.each([0o620, 0o602, 0o4600, 0o2600])("拒绝危险文件权限 %i", async mode => {
        const test = npmFixture();
        // macOS /tmp 可继承非当前用户所属组；内核会清除该组文件的 setgid。
        fs.chownSync(path.join(test.source, "bin.js"), process.getuid!(), process.getgid!());
        fs.chmodSync(path.join(test.source, "bin.js"), mode);
        expect(fs.statSync(path.join(test.source, "bin.js")).mode & 0o7777).toBe(mode);
        await expect(captureLegacyRuntimeTree(test.source, test.store, test.id)).rejects.toThrow();
    });

    it.each([0o720, 0o702, 0o4700, 0o2700])("拒绝危险目录权限 %i", async mode => {
        const test = npmFixture();
        fs.chownSync(test.source, process.getuid!(), process.getgid!());
        fs.chmodSync(test.source, mode);
        expect(fs.statSync(test.source).mode & 0o7777).toBe(mode);
        await expect(captureLegacyRuntimeTree(test.source, test.store, test.id)).rejects.toThrow();
    });

    it("拒绝非私有存储目录", async () => {
        const test = npmFixture();
        fs.chmodSync(test.store, 0o750);
        await expect(captureLegacyRuntimeTree(test.source, test.store, test.id)).rejects.toThrow();
    });

    it("拒绝将存储目录放在被复制的源目录内", async () => {
        const test = npmFixture();
        const nested = path.join(test.source, "snapshots");
        fs.mkdirSync(nested, { mode: 0o700 });
        await expect(captureLegacyRuntimeTree(test.source, nested, test.id)).rejects.toThrow();
    });

    it("同一编号不得覆盖已有产物", async () => {
        const test = npmFixture();
        const receipt = await captureLegacyRuntimeTree(test.source, test.store, test.id);
        test.write("bin.js", "throw new Error('new runtime');\n");
        await expect(captureLegacyRuntimeTree(test.source, test.store, test.id)).rejects.toThrow();
        await verifyLegacyRuntimeTree(receipt);
    });

    it("拒绝超过单文件限额的稀疏文件", async () => {
        const test = npmFixture();
        const huge = test.write("oversized", "");
        fs.truncateSync(huge, 512 * 1024 * 1024 + 1);
        await expect(captureLegacyRuntimeTree(test.source, test.store, test.id)).rejects.toThrow();
    });

    it.skipIf(process.platform === "win32")("拒绝 FIFO 特殊文件", async () => {
        const test = npmFixture();
        execFileSync("mkfifo", [path.join(test.source, "named-pipe")]);
        await expect(captureLegacyRuntimeTree(test.source, test.store, test.id)).rejects.toThrow();
    });
});
