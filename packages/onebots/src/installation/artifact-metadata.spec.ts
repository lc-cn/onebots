import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { readArtifactMetadata } from "./artifact-metadata.js";
import { resolveGenerationPlan } from "./generation-resolver.js";

const roots: string[] = [];
afterEach(() => {
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
    vi.unstubAllGlobals();
});
const manifest = {
    name: "@onebots/adapter-mock",
    version: "99.0.1",
    peerDependencies: { "test-sdk": "^1.0.0" },
};
function entry(value: unknown, type = "0") {
    const content = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(512);
    header.write("package/package.json");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    return Buffer.concat([header, content, Buffer.alloc((512 - (content.length % 512)) % 512)]);
}
function fixture(entries = [entry(manifest)]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-local-meta-"));
    roots.push(root);
    const bytes = gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
    const file = path.join(root, "mock.tgz");
    fs.writeFileSync(file, bytes);
    return {
        name: manifest.name,
        version: manifest.version,
        spec: `file:${file}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
    };
}
it("尚未发布的 patch 工件从归档读取 peer，离线创建计划", async () => {
    const artifact = fixture();
    const fetcher = vi.fn(() => {
        throw new Error("不应查询未发布的 npm 版本");
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await resolveGenerationPlan(
        { adapters: ["mock"], protocols: [], applications: ["nonebot"] },
        {
            host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
            core: { name: "@onebots/core", version: "1.2.10", spec: "1.2.10" },
            extensionVersions: { [manifest.name]: manifest.version },
            artifacts: { [manifest.name]: artifact },
        },
    );
    expect(result.plan.extensions[0].peerDependencies).toEqual(manifest.peerDependencies);
    expect(result.plan.extensions[0].version).toBe(manifest.version);
    expect(fetcher).not.toHaveBeenCalled();
});
it("拒绝被篡改或身份不匹配的本地工件且不回退 npm", async () => {
    const artifact = fixture();
    await expect(readArtifactMetadata({ ...artifact, sha256: "a".repeat(64) })).rejects.toThrow(
        "本地扩展工件元数据无法验证",
    );
    const mismatched = fixture([entry({ ...manifest, version: "0.0.0" })]);
    await expect(
        resolveGenerationPlan(
            { adapters: ["mock"], protocols: [], applications: [] },
            {
                host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
                core: { name: "@onebots/core", version: "1.2.10", spec: "1.2.10" },
                extensionVersions: { [manifest.name]: manifest.version },
                artifacts: { [manifest.name]: mismatched },
            },
        ),
    ).rejects.toThrow("扩展版本元数据不可用");
});
it("拒绝重复清单、链接和扩展头，不从歧义归档读取元数据", async () => {
    for (const entries of [
        [entry(manifest), entry(manifest)],
        [entry(manifest, "2")],
        [entry(manifest, "x")],
    ]) {
        await expect(readArtifactMetadata(fixture(entries))).rejects.toThrow(
            "本地扩展工件元数据无法验证",
        );
    }
});
