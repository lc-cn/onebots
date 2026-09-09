import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { readReleaseArchive } from "./release-archive.js";
import { loadRuntimeArtifacts } from "./runtime-artifacts.js";
import type { GenerationArtifact } from "./generation-plan.js";

const FAILURE = "目标发布版本无法验证，请检查公开源或选择兼容的 OneBots 版本";
const REGISTRY = "https://registry.npmjs.org";
const META_LIMIT = 2 * 1024 * 1024;
const ARCHIVE_LIMIT = 32 * 1024 * 1024;
export interface ResolvedRelease {
    host: GenerationArtifact;
    core: GenerationArtifact;
    extensionVersions: Readonly<Record<string, string>>;
    /** 本次确实检查过的宿主发布包摘要，不是活动安装目录的摘要。 */
    archiveSha256: string;
    /** 已按 registry integrity 验证的精确归档；可信安装入口可将这些字节固化为 file: 工件。 */
    archives?: {
        host: { bytes: Buffer; sha256: string };
        core: { bytes: Buffer; sha256: string };
    };
}

/** 公开源只读检查：不调用 npm、不读取 npmrc、不执行目标宿主或第三方插件。 */
export async function resolveRelease(exactVersion?: string): Promise<ResolvedRelease> {
    try {
        if (exactVersion !== undefined && !exact(exactVersion)) throw new Error();
        const latest = exactVersion === undefined ? await metadata("latest") : undefined;
        const version = exactVersion ?? (record(latest) ? latest.version : undefined);
        if (!exact(version)) throw new Error();
        // latest 只用于选择版本；后续所有读取都绑定精确版本。
        const published = await metadata(version);
        if (
            !record(published) ||
            published.name !== "onebots" ||
            published.version !== version ||
            !record(published.dist)
        )
            throw new Error();
        const archive = await verifiedArchive(
            published,
            `${REGISTRY}/onebots/-/onebots-${version}.tgz`,
        );
        const { manifest, catalog } = await readReleaseArchive(archive);
        const release = parseReleaseCatalog(version, manifest, catalog);
        const corePublished = await metadataFor("@onebots/core", release.core.version);
        if (
            !record(corePublished) ||
            corePublished.name !== "@onebots/core" ||
            corePublished.version !== release.core.version
        )
            throw new Error();
        const coreArchive = await verifiedArchive(
            corePublished,
            `${REGISTRY}/@onebots/core/-/core-${release.core.version}.tgz`,
        );
        const archiveSha256 = createHash("sha256").update(archive).digest("hex");
        const coreSha256 = createHash("sha256").update(coreArchive).digest("hex");
        return Object.freeze({
            ...release,
            archiveSha256,
            archives: {
                host: { bytes: archive, sha256: archiveSha256 },
                core: { bytes: coreArchive, sha256: coreSha256 },
            },
        });
    } catch {
        // HTTP、归档和解析错误均可能包含不可信正文；只返回固定诊断。
        throw new Error(FAILURE);
    }
}

/** 本地工件入口只接受产品生成的清单、同目录归档及逐字节摘要，再交给不可变候选安装器。 */
export async function resolveLocalRelease(
    file: string,
    exactVersion?: string,
): Promise<ResolvedRelease> {
    try {
        if (!path.isAbsolute(file)) throw new Error();
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw new Error();
        const manifest: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!record(manifest) || !record(manifest.host) || !record(manifest.core))
            throw new Error();
        const hostVersion = manifest.host.version;
        const coreVersion = manifest.core.version;
        if (
            !exact(hostVersion) ||
            !exact(coreVersion) ||
            (exactVersion !== undefined && hostVersion !== exactVersion)
        )
            throw new Error();
        const local = loadRuntimeArtifacts(file, {
            host: { name: "onebots", version: hostVersion, spec: hostVersion },
            core: { name: "@onebots/core", version: coreVersion, spec: coreVersion },
        });
        const hostArchive = localArchive(local.host.spec, local.host.sha256);
        const coreArchive = localArchive(local.core.spec, local.core.sha256);
        const { manifest: hostManifest, catalog } = await readReleaseArchive(hostArchive);
        const release = parseReleaseCatalog(hostVersion, hostManifest, catalog);
        if (release.core.version !== coreVersion) throw new Error();
        const hostSha256 = local.host.sha256;
        const coreSha256 = local.core.sha256;
        if (!hostSha256 || !coreSha256) throw new Error();
        return Object.freeze({
            ...release,
            host: Object.freeze(local.host),
            core: Object.freeze(local.core),
            archiveSha256: hostSha256,
            archives: {
                host: { bytes: hostArchive, sha256: hostSha256 },
                core: { bytes: coreArchive, sha256: coreSha256 },
            },
        });
    } catch {
        throw new Error("本地管理程序运行工件无法验证；未下载候选或修改系统服务");
    }
}

function localArchive(spec: string, expected: string | undefined): Buffer {
    if (!spec.startsWith("file:") || !/^[a-f0-9]{64}$/.test(expected ?? "")) throw new Error();
    const file = spec.slice(5);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > ARCHIVE_LIMIT)
        throw new Error();
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error();
    return bytes;
}

export function parseReleaseCatalog(
    version: string,
    manifest: unknown,
    catalog: unknown,
): Omit<ResolvedRelease, "archiveSha256"> {
    if (
        !exact(version) ||
        !record(manifest) ||
        manifest.name !== "onebots" ||
        manifest.version !== version ||
        !record(manifest.dependencies)
    )
        throw new Error(FAILURE);
    const coreVersion = manifest.dependencies["@onebots/core"];
    if (
        !exact(coreVersion) ||
        !record(catalog) ||
        catalog.schemaVersion !== 2 ||
        !record(catalog.packages)
    )
        throw new Error(FAILURE);
    const entries = Object.entries(catalog.packages);
    if (entries.length === 0 || entries.length > 256) throw new Error(FAILURE);
    const versions: Record<string, string> = Object.create(null);
    for (const [name, entry] of entries) {
        if (
            !/^@onebots\/(?:adapter|protocol)-[a-z0-9][a-z0-9-]{0,99}$/.test(name) ||
            !record(entry) ||
            !exact(entry.version)
        )
            throw new Error(FAILURE);
        versions[name] = entry.version;
    }
    return Object.freeze({
        host: Object.freeze({ name: "onebots", version, spec: version }),
        core: Object.freeze({ name: "@onebots/core", version: coreVersion, spec: coreVersion }),
        extensionVersions: Object.freeze(versions),
    });
}
async function metadata(version: string): Promise<unknown> {
    return metadataFor("onebots", version);
}
async function metadataFor(name: string, version: string): Promise<unknown> {
    return JSON.parse(
        (
            await download(
                `${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
                META_LIMIT,
            )
        ).toString("utf8"),
    );
}
async function verifiedArchive(
    published: Record<string, unknown>,
    tarball: string,
): Promise<Buffer> {
    if (
        !record(published.dist) ||
        published.dist.tarball !== tarball ||
        typeof published.dist.integrity !== "string"
    )
        throw new Error();
    const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(published.dist.integrity);
    if (!match) throw new Error();
    const archive = await download(tarball, ARCHIVE_LIMIT);
    if (createHash("sha512").update(archive).digest("base64") !== match[1]) throw new Error();
    return archive;
}
async function download(url: string, limit: number): Promise<Buffer> {
    const response = await fetch(url, {
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: url.endsWith(".tgz") ? "application/octet-stream" : "application/json" },
    });
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error();
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
        await response.body.cancel();
        throw new Error();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > limit) throw new Error();
            chunks.push(next.value);
        }
    } finally {
        await reader.cancel();
        reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown): value is string {
    return typeof value === "string" && semver.valid(value) === value;
}
