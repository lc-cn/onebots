import semver from "semver";
import { readGenerationPlan } from "../installation/generation-runtime.js";
import { resolveRelease, type ResolvedRelease } from "../installation/release-resolver.js";
import { freezeGenerationArtifacts } from "../installation/generation-artifacts.js";
import {
    createGenerationPlan,
    type GenerationPlan,
    type GenerationSelection,
} from "../installation/generation-plan.js";
import {
    resolveGenerationPlan,
    type GenerationResolverConfig,
} from "../installation/generation-resolver.js";
import type { GenerationStore } from "../installation/generation-store.js";

export interface UpdateBase {
    generationId: string | null;
    configRevision: string;
}
export interface UpdateConfirmation {
    configRevision: string;
    archiveSha256: string;
}

/** 升级清单来自已验证安装收据，启用配置不能冒充完整安装清单。 */
export async function prepareInstallationUpdate(input: {
    expected: UpdateBase;
    store: GenerationStore;
    resolver: GenerationResolverConfig;
    artifactsDirectory: string;
    currentSelection?(): GenerationSelection;
    resolveRelease?(): Promise<ResolvedRelease>;
    assertCurrent(): void;
}) {
    input.assertCurrent();
    let current: GenerationPlan;
    if (input.expected.generationId !== null) {
        current = readGenerationPlan(input.store.readVerified(input.expected.generationId));
    } else {
        const selection = input.currentSelection?.();
        if (
            !selection ||
            [selection.adapters, selection.protocols, selection.applications].some(
                names => !Array.isArray(names) || names.length > 0,
            )
        )
            throw new Error("当前内置运行版本缺少完整安装收据，请先确认并安装完整依赖清单");
        current = createGenerationPlan({
            host: input.resolver.host,
            core: input.resolver.core,
            selection,
            extensions: [],
        });
    }
    const release = await (input.resolveRelease ?? resolveRelease)();
    input.assertCurrent();
    if (!/^[a-f0-9]{64}$/.test(release.archiveSha256)) throw new Error("目标发布包摘要无效");
    if (semver.lt(release.host.version, current.host.version))
        throw new Error("公开最新版本低于当前运行版本，拒绝降级");
    const resolver = await freezeGenerationArtifacts(
        {
            host: release.host,
            core: release.core,
            extensionVersions: release.extensionVersions,
            target: input.resolver.target,
            fetchMetadata: input.resolver.fetchMetadata,
        },
        input.artifactsDirectory,
    );
    input.assertCurrent();
    const result = await resolveGenerationPlan(current.selection, resolver);
    input.assertCurrent();
    const versions = new Map(packages(current).map(item => [item.name, item.version]));
    const comparison = packages(result.plan).map(item => ({
        name: item.name,
        current: versions.get(item.name) ?? null,
        target: item.version,
    }));
    const equal =
        comparison.length === versions.size &&
        comparison.every(item => item.current === item.target);
    if (release.host.version === current.host.version && !equal)
        throw new Error("当前宿主版本与发布目录组合不一致，请先核对安装收据");
    return {
        state: equal ? ("current" as const) : ("updates_available" as const),
        base: { ...input.expected },
        packages: comparison,
        peers: result.plan.peerRequirements,
        recommendations: result.recommendations,
        plan: result.plan,
        update: {
            configRevision: input.expected.configRevision,
            archiveSha256: release.archiveSha256,
        },
    };
}

function packages(plan: GenerationPlan) {
    return [
        plan.host,
        plan.core,
        ...plan.extensions.map(extension => ({
            name: extension.packageName,
            version: extension.version,
        })),
    ];
}
