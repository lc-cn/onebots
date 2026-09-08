import { createHash } from "node:crypto";
import {
    chmod,
    link,
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeGenerationArtifacts } from "./generation-artifacts.js";
import { createGenerationPlan } from "./generation-plan.js";
import type { GenerationResolverConfig } from "./generation-resolver.js";

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
    );
});

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "onebots-artifact-freeze-"));
    directories.push(directory);
    const source = join(directory, "host.tgz");
    const contents = Buffer.alloc(180_000, "a"); // Multiple copy chunks, not a single read/write.
    await writeFile(source, contents);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const config: GenerationResolverConfig = {
        host: { name: "onebots", version: "1.2.12", spec: `file:${source}`, sha256 },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
    };
    return {
        directory,
        source,
        contents,
        sha256,
        config,
        cache: join(directory, ".control/artifacts"),
    };
}

describe("freeze local generation artifacts", () => {
    it("copies exact bytes to a private read-only hash path while preserving registry artifacts", async () => {
        const { config, cache, contents, sha256, source } = await fixture();
        const frozen = await freezeGenerationArtifacts(config, cache);
        const snapshot = frozen.host.spec.slice(5);
        expect(snapshot).toBe(join(await realpath(cache), `${sha256}.tgz`));
        expect(await readFile(snapshot)).toEqual(contents);
        expect((await stat(snapshot)).mode & 0o777).toBe(0o400);
        expect((await stat(cache)).mode & 0o777).toBe(0o700);
        expect((await stat(snapshot)).ino).not.toBe((await stat(source)).ino);
        expect(frozen.core).toEqual(config.core);
        expect(config.host.spec).toBe(`file:${source}`);
        expect(await readdir(cache)).toEqual([`${sha256}.tgz`]);
    });

    it("rejects changed source bytes instead of accepting a previously declared source hash", async () => {
        const { config, source, cache, sha256 } = await fixture();
        await writeFile(source, "changed-after-plan-input");
        await expect(freezeGenerationArtifacts(config, cache)).rejects.toThrow("声明摘要不一致");
        expect(await readdir(cache)).not.toContain(`${sha256}.tgz`);
        expect(await readdir(cache)).toEqual([]);
    });

    it("keeps plans and installed bytes stable after original source mutation or removal", async () => {
        const { config, source, cache, contents } = await fixture();
        const frozen = await freezeGenerationArtifacts(config, cache);
        const plan = createGenerationPlan({
            ...frozen,
            extensions: [],
            selection: { adapters: [], protocols: [], applications: [] },
        });
        await writeFile(source, "different-package");
        expect(await freezeGenerationArtifacts(config, cache)).toEqual(frozen);
        await rm(source);
        const reused = await freezeGenerationArtifacts(config, cache);
        expect(
            createGenerationPlan({
                ...reused,
                extensions: [],
                selection: { adapters: [], protocols: [], applications: [] },
            }).digest,
        ).toBe(plan.digest);
        expect(await readFile(reused.host.spec.slice(5))).toEqual(contents);
    });

    it("rejects a corrupt existing hash snapshot without overwriting it from the source", async () => {
        const { config, cache } = await fixture();
        const frozen = await freezeGenerationArtifacts(config, cache);
        const snapshot = frozen.host.spec.slice(5);
        await chmod(snapshot, 0o600);
        await writeFile(snapshot, "corrupt-cache");
        await expect(freezeGenerationArtifacts(config, cache)).rejects.toThrow(
            "已有工件快照摘要不一致",
        );
        expect(await readFile(snapshot, "utf8")).toBe("corrupt-cache");
    });

    it("freezes host, core and configured file extensions while preserving metadata callbacks", async () => {
        const { config, cache } = await fixture();
        config.core = { ...config.host, name: "@onebots/core" };
        config.artifacts = {
            "@onebots/adapter-mock": { ...config.host, name: "@onebots/adapter-mock" },
        };
        config.fetchMetadata = async () => ({ name: "metadata" });
        const [first, second] = await Promise.all([
            freezeGenerationArtifacts(config, cache),
            freezeGenerationArtifacts(config, cache),
        ]);
        expect(first).toEqual(second);
        expect(first.core.spec).toBe(first.host.spec);
        expect(first.artifacts?.["@onebots/adapter-mock"].spec).toBe(first.host.spec);
        expect(first.fetchMetadata).toBe(config.fetchMetadata);
        expect(await readdir(cache)).toHaveLength(1);
    });

    it("rejects linked files and keeps filesystem error paths out of public diagnostics", async () => {
        const { config, source, cache, directory } = await fixture();
        const linked = join(directory, "linked.tgz");
        await symlink(source, linked);
        await expect(
            freezeGenerationArtifacts(
                { ...config, host: { ...config.host, spec: `file:${linked}` } },
                cache,
            ),
        ).rejects.toThrow("符号链接");
        await rm(linked);
        await link(source, linked);
        await expect(freezeGenerationArtifacts(config, cache)).rejects.toThrow("独立常规文件");
        await rm(linked);
        await rm(source);
        try {
            await freezeGenerationArtifacts(config, cache);
            throw new Error("unexpected success");
        } catch (error) {
            expect(String(error)).not.toContain(directory);
            expect(String(error)).toContain("无法读取或写入");
        }
    });

    it("rejects a symbolic cache directory", async () => {
        const { config, cache, directory } = await fixture();
        await mkdir(join(directory, ".control"));
        await symlink(directory, cache);
        await expect(freezeGenerationArtifacts(config, cache)).rejects.toThrow("私有常规目录");
    });
});
