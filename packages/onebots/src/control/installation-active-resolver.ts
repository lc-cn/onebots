import fs from "node:fs";
import path from "node:path";
import { readGenerationPlan } from "../installation/generation-runtime.js";
import { parseReleaseCatalog } from "../installation/release-resolver.js";
import type { GenerationStore } from "../installation/generation-store.js";
import type { GenerationResolverConfig } from "../installation/generation-resolver.js";

/** 管理服务自身版本不是活动网关的版本；坏收据或目录不能回退到宿主旧目录。 */
export function activeInstallationResolver(
    store: GenerationStore,
    id: string | null,
    bundled: GenerationResolverConfig,
): GenerationResolverConfig {
    if (id === null) return bundled;
    try {
        const generation = store.readVerified(id);
        const plan = readGenerationPlan(generation);
        const root = fs.realpathSync(generation.directory);
        const read = (relative: string): unknown => {
            const filename = path.join(root, relative);
            const stat = fs.lstatSync(filename);
            if (
                !stat.isFile() ||
                stat.isSymbolicLink() ||
                stat.nlink !== 1 ||
                stat.size > 2 * 1024 * 1024
            )
                throw new Error();
            const resolved = fs.realpathSync(filename);
            if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error();
            return JSON.parse(fs.readFileSync(resolved, "utf8"));
        };
        const release = parseReleaseCatalog(
            plan.host.version,
            read("node_modules/onebots/package.json"),
            read("node_modules/onebots/lib/extension-capability-catalog.json"),
        );
        if (release.core.version !== plan.core.version) throw new Error();
        return {
            host: plan.host,
            core: plan.core,
            target: plan,
            extensionVersions: release.extensionVersions,
            fetchMetadata: bundled.fetchMetadata,
        };
    } catch {
        throw new Error("活动运行版本的发布目录无法验证，拒绝回退到旧宿主版本");
    }
}
