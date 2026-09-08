import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { parseReleaseCatalog, resolveRelease } from "./release-resolver.js";
import { readReleaseArchive } from "./release-archive.js";
import { resolveGenerationPlan } from "./generation-resolver.js";
vi.mock("./release-archive.js", () => ({ readReleaseArchive: vi.fn() }));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
const version = "1.2.99";
const manifest = { name: "onebots", version, dependencies: { "@onebots/core": "1.2.33" } };
const catalog = {
    schemaVersion: 2,
    packages: { "@onebots/adapter-matrix": { version: "3.0.99" } },
};
function fixture() {
    vi.clearAllMocks();
    const archive = Buffer.from("synthetic-public-package");
    const published = {
        name: "onebots",
        version,
        dist: {
            tarball: `https://registry.npmjs.org/onebots/-/onebots-${version}.tgz`,
            integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
        },
    };
    vi.mocked(readReleaseArchive).mockResolvedValue({ manifest, catalog });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
        return String(url).endsWith(".tgz") ? new Response(archive) : Response.json(published);
    });
    vi.stubGlobal("fetch", fetcher);
    return { archive, published, fetcher };
}
it("latest仅选择精确版本，校验归档摘要后读取目标发布目录", async () => {
    const f = fixture();
    const release = await resolveRelease();
    expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([
        "https://registry.npmjs.org/onebots/latest",
        `https://registry.npmjs.org/onebots/${version}`,
        f.published.dist.tarball,
    ]);
    expect(release.host.version).toBe(version);
    expect(release.core.version).toBe("1.2.33");
    expect(release.extensionVersions["@onebots/adapter-matrix"]).toBe("3.0.99");
    expect(release.archiveSha256).toBe(createHash("sha256").update(f.archive).digest("hex"));
    for (const [, options] of f.fetcher.mock.calls) {
        expect(options).toMatchObject({ redirect: "error", credentials: "omit" });
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.stringify(options?.headers)).not.toMatch(/authorization/i);
    }
});
it("指定精确版本不查询latest，失配摘要不读取归档", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
        Response.json({
            ...f.published,
            dist: {
                ...f.published.dist,
                integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
            },
        }),
    );
    await expect(resolveRelease(version)).rejects.toThrow("无法验证");
    expect(f.fetcher.mock.calls[0][0]).toBe(`https://registry.npmjs.org/onebots/${version}`);
    expect(readReleaseArchive).not.toHaveBeenCalled();
});
it.each(["latest", "^1.2.0", "https://private.example/archive", "1.2.3/../../x"])(
    "拒绝客户端版本选择 %s",
    async input => {
        const f = fixture();
        await expect(resolveRelease(input)).rejects.toThrow("无法验证");
        expect(f.fetcher).not.toHaveBeenCalled();
    },
);
it("拒绝自定义归档URL及超限元数据，不返回原始正文", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
        Response.json({
            ...f.published,
            dist: { ...f.published.dist, tarball: "https://private.example/secret" },
        }),
    );
    await expect(resolveRelease(version)).rejects.toThrow("无法验证");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.fetcher.mockResolvedValueOnce(
        new Response("private-secret", {
            headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        }),
    );
    await expect(resolveRelease(version)).rejects.toThrow("无法验证");
});
it("目录必须匹配宿主身份、精确core版本和精确扩展版本", () => {
    for (const invalid of [
        { ...manifest, version: "1.2.98" },
        { ...manifest, dependencies: { "@onebots/core": "^1.2.0" } },
    ]) {
        expect(() => parseReleaseCatalog(version, invalid, catalog)).toThrow();
    }
    expect(() =>
        parseReleaseCatalog(version, manifest, {
            schemaVersion: 2,
            packages: { "@onebots/adapter-matrix": { version: "latest" } },
        }),
    ).toThrow();
});
it("安装计划使用目标目录而非当前宿主版本，缺失项不回落当前目录", async () => {
    const release = parseReleaseCatalog(version, manifest, catalog);
    const fetchMetadata = vi.fn(async (name: string, selected: string) => ({
        name,
        version: selected,
    }));
    const selection = { adapters: ["matrix"], protocols: [], applications: [] };
    const result = await resolveGenerationPlan(selection, { ...release, fetchMetadata });
    expect(result.plan.extensions[0].version).toBe("3.0.99");
    expect(fetchMetadata).toHaveBeenCalledWith("@onebots/adapter-matrix", "3.0.99");
    await expect(
        resolveGenerationPlan(selection, { ...release, extensionVersions: {}, fetchMetadata }),
    ).rejects.toThrow("可信版本目录");
});
