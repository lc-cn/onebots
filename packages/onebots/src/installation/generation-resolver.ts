import semver from "semver";
import { TRUSTED_EXTENSION_CATALOG } from "../trusted-extension-catalog.js";
import { getExtensionPackageCatalogEntry } from "../extension-capability-catalog.js";
import { getFrameworkProfile, listFrameworkProfiles } from "../framework-integration.js";
import {
    createGenerationPlan,
    type GenerationArtifact,
    type GenerationExtension,
    type GenerationPlan,
    type GenerationSelection,
    type GenerationTarget,
} from "./generation-plan.js";

const METADATA_FAILURE = "扩展版本元数据不可用，请检查网络或宿主扩展目录";
const MAX_METADATA_BYTES = 256 * 1024;
const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
// 在加载第三方插件之前固定内置方案集合；后续动态注册不能扩大安装入口。
const BUILTIN_FRAMEWORKS = new Map(
    listFrameworkProfiles().map(item => {
        const profile = getFrameworkProfile(item.id);
        if (!profile) throw new Error("内置框架目录不完整");
        return [item.id, Object.freeze({ ...profile })];
    }),
);

export interface GenerationResolverConfig {
    host: GenerationArtifact;
    core: GenerationArtifact;
    target?: GenerationTarget;
    /** 仅由已验证目标发布目录提供，不接受 HTTP 直接注入版本表。 */
    extensionVersions?: Readonly<Record<string, string>>;
    /** 仅受信宿主/开发测试注入，不接受 HTTP 请求指定工件或可执行路径。 */
    artifacts?: Readonly<Record<string, GenerationArtifact>>;
    /** 本地 tgz 的原始 manifest 可由受信宿主读取后注入，仍执行完整身份校验。 */
    fetchMetadata?(packageName: string, exactVersion: string): Promise<unknown>;
}

export interface GenerationResolution {
    plan: GenerationPlan;
    recommendations: string[];
}

export async function resolveGenerationPlan(
    selection: GenerationSelection,
    config: GenerationResolverConfig,
): Promise<GenerationResolution> {
    const recommendations: string[] = [];
    const builtinApplications: string[] = [];
    const requested: Array<{
        type: "adapter" | "protocol";
        name: string;
        packageName: string;
        version: string;
    }> = [];
    for (const [type, names] of [
        ["adapter", selection.adapters],
        ["protocol", selection.protocols],
    ] as const) {
        if (
            !Array.isArray(names) ||
            names.length > TRUSTED_EXTENSION_CATALOG.length ||
            new Set(names).size !== names.length
        )
            throw new Error("扩展选择无效");
        for (const name of names) {
            const entry = TRUSTED_EXTENSION_CATALOG.find(
                item => item.type === type && item.name === name,
            );
            const version =
                entry && (config.extensionVersions
                    ? config.extensionVersions[entry.packageName]
                    : getExtensionPackageCatalogEntry(entry.packageName)?.packageVersion);
            if (!entry || !version || !semver.valid(version))
                throw new Error("所选扩展不在宿主可信版本目录中");
            requested.push({ type, name, packageName: entry.packageName, version });
        }
    }
    if (
        !Array.isArray(selection.applications) ||
        selection.applications.length > BUILTIN_FRAMEWORKS.size ||
        new Set(selection.applications).size !== selection.applications.length
    )
        throw new Error("框架选择无效");
    for (const name of selection.applications) {
        const profile = BUILTIN_FRAMEWORKS.get(name);
        if (!profile || String(profile.applicationStage) === "planned")
            throw new Error("所选框架尚不能注册为内置扩展");
        builtinApplications.push(name);
        const suggested = profile.protocol.replace(".", "-");
        if (!selection.protocols.includes(suggested)) {
            recommendations.push(
                `${profile.displayName} 文档使用 ${suggested}；如需该连接方式可自行选择，当前仅注册框架扩展。`,
            );
        }
    }
    const metadataFetcher = config.fetchMetadata ?? fetchRegistryMetadata;
    const extensions: GenerationExtension[] = [];
    // 串行、有界地读取可信目录条目，避免用户选择放大并发 registry 请求。
    for (const entry of requested) {
        const artifact = config.artifacts?.[entry.packageName] ?? {
            name: entry.packageName,
            version: entry.version,
            spec: entry.version,
        };
        if (artifact.name !== entry.packageName || artifact.version !== entry.version)
            throw new Error("受信扩展工件必须与宿主目录的精确版本一致");
        let metadata: unknown;
        try {
            metadata = await metadataFetcher(entry.packageName, entry.version);
        } catch {
            throw new Error(METADATA_FAILURE);
        }
        const peerDependencies = requiredPeers(metadata, entry.packageName, entry.version);
        extensions.push({
            ...entry,
            version: artifact.version,
            spec: artifact.spec,
            ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
            peerDependencies,
        });
    }
    return {
        plan: createGenerationPlan({
            host: config.host,
            core: config.core,
            target: config.target,
            selection,
            extensions,
            builtinApplications,
        }),
        recommendations,
    };
}

/** 只读取公开 npm 的精确版本元数据；不使用下载 Token、npmrc 或任意用户 URL。 */
export async function fetchRegistryMetadata(
    packageName: string,
    exactVersion: string,
): Promise<unknown> {
    if (!PACKAGE_NAME.test(packageName) || !semver.valid(exactVersion))
        throw new Error(METADATA_FAILURE);
    try {
        const response = await fetch(
            `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(exactVersion)}`,
            {
                method: "GET",
                redirect: "error",
                credentials: "omit",
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(10_000),
            },
        );
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error(METADATA_FAILURE);
        }
        const length = response.headers.get("content-length");
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_METADATA_BYTES)) {
            await response.body.cancel();
            throw new Error(METADATA_FAILURE);
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > MAX_METADATA_BYTES) throw new Error(METADATA_FAILURE);
                chunks.push(chunk.value);
            }
        } finally {
            try {
                await reader.cancel();
            } finally {
                reader.releaseLock();
            }
        }
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        requiredPeers(value, packageName, exactVersion);
        return value;
    } catch {
        throw new Error(METADATA_FAILURE);
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredPeers(
    value: unknown,
    packageName: string,
    version: string,
): Record<string, string> {
    if (
        !record(value) ||
        value.name !== packageName ||
        value.version !== version ||
        (value.peerDependencies !== undefined && !record(value.peerDependencies)) ||
        (value.peerDependenciesMeta !== undefined && !record(value.peerDependenciesMeta))
    )
        throw new Error(METADATA_FAILURE);
    const peers = value.peerDependencies ?? {};
    const metadata = value.peerDependenciesMeta ?? {};
    const result: Record<string, string> = {};
    for (const [name, range] of Object.entries(peers)) {
        if (!PACKAGE_NAME.test(name) || typeof range !== "string" || !semver.validRange(range))
            throw new Error(METADATA_FAILURE);
        const declaration = metadata[name];
        if (
            declaration !== undefined &&
            (!record(declaration) ||
                (declaration.optional !== undefined && typeof declaration.optional !== "boolean"))
        )
            throw new Error(METADATA_FAILURE);
        if (record(declaration) && declaration.optional === true) continue;
        Object.defineProperty(result, name, { value: range, enumerable: true });
    }
    return result;
}
