import { afterEach, describe, expect, it, vi } from "vitest";
import semver from "semver";
import { getExtensionPackageCatalogEntry } from "../extension-capability-catalog.js";
import {
    fetchRegistryMetadata,
    resolveGenerationPlan,
    type GenerationResolverConfig,
} from "./generation-resolver.js";

vi.mock("../framework-integration.js", async original => {
    const actual = await original<typeof import("../framework-integration.js")>();
    const planned = {
        ...actual.listFrameworkProfiles()[0],
        id: "planned-fixture",
        applicationStage: "planned",
    };
    return {
        ...actual,
        listFrameworkProfiles: () => [...actual.listFrameworkProfiles(), planned],
        getFrameworkProfile: (id: string) =>
            id === planned.id ? planned : actual.getFrameworkProfile(id),
    };
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const matrix = "@onebots/adapter-matrix";
const matrixVersion = getExtensionPackageCatalogEntry(matrix)!.packageVersion;
const icqq = "@onebots/adapter-icqq";
const icqqVersion = getExtensionPackageCatalogEntry(icqq)!.packageVersion;
const selected = { adapters: ["matrix"], protocols: [], applications: [] };
function config(): GenerationResolverConfig {
    return {
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        fetchMetadata: async (name, version) => ({
            name,
            version,
            peerDependencies: {
                onebots: "^1.0.0",
                "@onebots/core": ">=1.0.0",
                "@icqqjs/icqq": "^0.6.0",
                "optional-sdk": "^1.0.0",
            },
            peerDependenciesMeta: { "optional-sdk": { optional: true } },
        }),
    };
}

describe("generation resolver", () => {
    it("使用可信目录精确版本，保留原始宿主/core/必需peer，仅剔除显式optional", async () => {
        const trusted = config();
        const metadata = vi.fn(trusted.fetchMetadata!);
        const result = await resolveGenerationPlan(selected, {
            ...trusted,
            fetchMetadata: metadata,
        });
        expect(metadata).toHaveBeenCalledWith(matrix, matrixVersion);
        expect(result.plan.extensions[0]).toMatchObject({
            packageName: matrix,
            version: matrixVersion,
            spec: matrixVersion,
        });
        expect(result.plan.extensions[0].peerDependencies).toEqual({
            onebots: "^1.0.0",
            "@onebots/core": ">=1.0.0",
            "@icqqjs/icqq": "^0.6.0",
        });
        expect(result.plan.dependencies).not.toHaveProperty("optional-sdk");
        expect(JSON.stringify(result.plan)).not.toContain("latest");
    });

    it("选择ICQQ时将宿主目录声明的私有SDK提升为必需peer", async () => {
        const result = await resolveGenerationPlan(
            { adapters: ["icqq"], protocols: [], applications: [] },
            {
                ...config(),
                fetchMetadata: async () => ({
                    name: icqq,
                    version: icqqVersion,
                    peerDependencies: {
                        onebots: "1.2.12",
                        "@icqqjs/icqq": "^1.10.18",
                    },
                    peerDependenciesMeta: { "@icqqjs/icqq": { optional: true } },
                }),
            },
        );
        expect(result.plan.peerRequirements).toContainEqual({
            requestedBy: icqq,
            packageName: "@icqqjs/icqq",
            range: "^1.10.18",
        });
        expect(semver.satisfies("1.10.18", result.plan.dependencies["@icqqjs/icqq"])).toBe(true);
    });

    it("宿主目录不能把registry未声明或范围不同的peer注入安装计划", async () => {
        await expect(
            resolveGenerationPlan(
                { adapters: ["icqq"], protocols: [], applications: [] },
                {
                    ...config(),
                    fetchMetadata: async () => ({
                        name: icqq,
                        version: icqqVersion,
                        peerDependencies: { "@icqqjs/icqq": "^1.9.0" },
                    }),
                },
            ),
        ).rejects.toThrow("元数据不可用");
    });

    it("框架仅注册扩展，未选择文档协议时给建议但不添加协议", async () => {
        const selection = { adapters: [], protocols: [], applications: ["zhin"] };
        const result = await resolveGenerationPlan(selection, config());
        expect(result.plan.selection).toEqual(selection);
        expect(result.plan.builtinApplications).toEqual(["zhin"]);
        expect(result.recommendations).toHaveLength(1);
        expect(result.plan.extensions).toEqual([]);
    });

    it("未知/重复扩展以及planned框架在fetch之前拒绝", async () => {
        const fetchMetadata = vi.fn();
        for (const adapters of [
            ["../../other"],
            ["https://evil.example/pkg"],
            ["matrix", "matrix"],
        ]) {
            await expect(
                resolveGenerationPlan({ ...selected, adapters }, { ...config(), fetchMetadata }),
            ).rejects.toThrow();
        }
        await expect(
            resolveGenerationPlan(
                { adapters: [], protocols: [], applications: ["planned-fixture"] },
                config(),
            ),
        ).rejects.toThrow("尚不能注册");
        expect(fetchMetadata).not.toHaveBeenCalled();
    });

    it("本地tgz只能由受信配置注入且仍严格匹配目录身份版本", async () => {
        const artifact = {
            name: matrix,
            version: matrixVersion,
            spec: "file:/tmp/matrix-fixture.tgz",
            sha256: "a".repeat(64),
        };
        const result = await resolveGenerationPlan(selected, {
            ...config(),
            artifacts: { [matrix]: artifact },
        });
        expect(result.plan.extensions[0].spec).toBe(artifact.spec);
        await expect(
            resolveGenerationPlan(selected, {
                ...config(),
                artifacts: { [matrix]: { ...artifact, version: "99.0.0" } },
            }),
        ).rejects.toThrow("精确版本");
    });

    it("metadata身份/peer格式错误及宿主版本冲突均拒绝且不回显正文", async () => {
        for (const metadata of [
            { name: "synthetic-secret", version: matrixVersion },
            { name: matrix, version: "99.0.0" },
            {
                name: matrix,
                version: matrixVersion,
                peerDependencies: { bad: "file:/synthetic-secret" },
            },
        ]) {
            await expect(
                resolveGenerationPlan(selected, {
                    ...config(),
                    fetchMetadata: async () => metadata,
                }),
            ).rejects.toThrow(/^扩展版本元数据不可用，请检查网络或宿主扩展目录$/);
        }
        await expect(
            resolveGenerationPlan(selected, {
                ...config(),
                fetchMetadata: async (name, version) => ({
                    name,
                    version,
                    peerDependencies: { onebots: ">=99.0.0" },
                }),
            }),
        ).rejects.toThrow("原始 peer 约束");
    });
});

describe("public registry metadata", () => {
    it("只请求固定HTTPS精确版本，无下载授权且不跟随重定向", async () => {
        vi.stubEnv("NODE_AUTH_TOKEN", "synthetic-secret");
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        name: matrix,
                        version: matrixVersion,
                        peerDependencies: { onebots: "^1.0.0" },
                    }),
                ),
        );
        vi.stubGlobal("fetch", fetcher);
        await fetchRegistryMetadata(matrix, matrixVersion);
        const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(args[0]).toBe(
            `https://registry.npmjs.org/${encodeURIComponent(matrix)}/${matrixVersion}`,
        );
        expect(args[1]).toMatchObject({
            redirect: "error",
            credentials: "omit",
            headers: { Accept: "application/json" },
        });
        expect(args[1].signal).toBeInstanceOf(AbortSignal);
        expect(JSON.stringify(args)).not.toContain("synthetic-secret");
        await expect(fetchRegistryMetadata(matrix, "latest")).rejects.toThrow("元数据不可用");
        await expect(fetchRegistryMetadata("https://evil.example", matrixVersion)).rejects.toThrow(
            "元数据不可用",
        );
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("超限/坏JSON/网络超时响应只返回固定错误", async () => {
        for (const response of [
            new Response("synthetic-secret"),
            new Response("x".repeat(256 * 1024 + 1)),
            new Response("{}", { headers: { "Content-Length": "9999999" } }),
            new Response("synthetic-secret", { status: 403 }),
        ]) {
            vi.stubGlobal(
                "fetch",
                vi.fn(async () => response),
            );
            await expect(fetchRegistryMetadata(matrix, matrixVersion)).rejects.toThrow(
                /^扩展版本元数据不可用，请检查网络或宿主扩展目录$/,
            );
        }
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("synthetic-secret network timeout");
            }),
        );
        await expect(fetchRegistryMetadata(matrix, matrixVersion)).rejects.toThrow(
            /^扩展版本元数据不可用，请检查网络或宿主扩展目录$/,
        );
    });
});
