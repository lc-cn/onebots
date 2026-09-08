import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { packControlRuntime } from "../../scripts/pack-control-runtime.mjs";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
    );
});

async function fixture() {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "onebots-pack-control-"));
    directories.push(repositoryRoot);
    await writeFile(
        join(repositoryRoot, "package.json"),
        JSON.stringify({ private: true, packageManager: "pnpm@9.15.9" }),
    );
    await writeFile(
        join(repositoryRoot, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\ncatalog:\n  typescript: 5.9.3\n",
    );
    for (const [directory, name, version] of [
        ["core", "@onebots/core", "4.5.6"],
        ["onebots", "onebots", "7.8.9"],
    ]) {
        const root = join(repositoryRoot, "packages", directory);
        await mkdir(join(root, "lib/gateway"), { recursive: true });
        await writeFile(
            join(root, "package.json"),
            JSON.stringify({
                name,
                version,
                type: "module",
                files: ["lib"],
                main: "lib/index.js",
                dependencies: directory === "onebots" ? { "@onebots/core": "workspace:*" } : {},
                devDependencies: { typescript: "catalog:" },
            }),
        );
        await writeFile(join(root, "lib/index.js"), "export {};");
        await writeFile(join(root, "lib/gateway/entry.js"), "export {};");
        await writeFile(join(root, "config.yaml"), "token: SYNTHETIC_PACK_SECRET");
        await writeFile(
            join(root, ".npmrc"),
            "//registry.npmjs.org/:_authToken=SYNTHETIC_PACK_SECRET",
        );
    }
    const modules = join(repositoryRoot, "packages/onebots/node_modules/@onebots");
    await mkdir(modules, { recursive: true });
    await symlink(join(repositoryRoot, "packages/core"), join(modules, "core"), "junction");
    return { repositoryRoot, outputDirectory: join(repositoryRoot, "artifacts") };
}

describe("build-time control runtime artifacts", () => {
    it("packs only the two hosts with translated dependencies, relocatable metadata and matching digests", async () => {
        const options = await fixture();
        const manifest = await packControlRuntime(options);
        expect(manifest).toMatchObject({
            schemaVersion: 1,
            host: { name: "onebots", version: "7.8.9" },
            core: { name: "@onebots/core", version: "4.5.6" },
        });
        expect(Object.keys(manifest).sort()).toEqual(["core", "host", "schemaVersion"]);
        expect((await readdir(options.outputDirectory)).sort()).toEqual(
            ["manifest.json", manifest.host.file, manifest.core.file].sort(),
        );
        for (const artifact of [manifest.host, manifest.core]) {
            expect(Object.keys(artifact).sort()).toEqual(["file", "name", "sha256", "version"]);
            expect(artifact.file).not.toMatch(/[\\/]/);
            const tarball = join(options.outputDirectory, artifact.file);
            expect(
                createHash("sha256")
                    .update(await readFile(tarball))
                    .digest("hex"),
            ).toBe(artifact.sha256);
            const { stdout: listing } = await execute("tar", ["-tzf", tarball]);
            expect(listing).not.toMatch(/\.npmrc|config\.yaml|SYNTHETIC_PACK_SECRET/);
            const { stdout: content } = await execute("tar", [
                "-xOf",
                tarball,
                "package/package.json",
            ]);
            expect(content).not.toMatch(/workspace:|catalog:|SYNTHETIC_PACK_SECRET/);
            const metadata = JSON.parse(content);
            expect(metadata.devDependencies.typescript).toBe("5.9.3");
            if (artifact.name === "onebots")
                expect(metadata.dependencies["@onebots/core"]).toBe("4.5.6");
        }
        const serialized = await readFile(join(options.outputDirectory, "manifest.json"), "utf8");
        expect(JSON.parse(serialized)).toEqual(manifest);
        expect(serialized).not.toContain(options.repositoryRoot);
        await expect(packControlRuntime(options)).rejects.toThrow("已存在");
    });

    it("rejects a production archive that accidentally includes a private config instead of shipping it", async () => {
        const options = await fixture();
        await writeFile(
            join(options.repositoryRoot, "packages/core/lib/config.yaml"),
            "token: SYNTHETIC_PACK_SECRET",
        );
        await expect(packControlRuntime(options)).rejects.toThrow("私有配置");
        expect(await readdir(options.repositoryRoot)).not.toContain("artifacts");
    });
});
