import { createRequire } from "node:module";
import { FrameworkIntegrationRegistry } from "./framework-integration.js";
import { tryLoadPlugin, type PluginLoadOptions } from "./plugin-loader.js";

export interface LoadedFrameworkIntegration {
    request: string;
    packageName: string;
    version: string | null;
    frameworkIds: string[];
}

const loaded = new Map<string, LoadedFrameworkIntegration>();

export function frameworkIntegrationCandidates(name: string): string[] {
    return [`@onebots/framework-${name}`, `onebots-framework-${name}`, name];
}

/** 动态导入框架方案包；包必须在求值期间至少注册一个新的 provider。 */
export async function loadFrameworkIntegration(
    name: string,
    runtimeRequire: NodeJS.Require = createRequire(import.meta.url),
    options: PluginLoadOptions = {},
): Promise<LoadedFrameworkIntegration> {
    const previous = loaded.get(name);
    if (previous) return { ...previous, frameworkIds: [...previous.frameworkIds] };
    const snapshot = FrameworkIntegrationRegistry.capture();
    const before = new Set(snapshot.keys());
    const result = await tryLoadPlugin(
        "框架方案",
        name,
        frameworkIntegrationCandidates(name),
        runtimeRequire,
        options,
    );
    if (result.loaded === false) {
        FrameworkIntegrationRegistry.restore(snapshot);
        throw new Error(result.message);
    }
    const frameworkIds = FrameworkIntegrationRegistry.list()
        .map(provider => provider.profile.id)
        .filter(id => !before.has(id));
    if (frameworkIds.length === 0) {
        FrameworkIntegrationRegistry.restore(snapshot);
        throw new Error(`加载框架方案 ${name} 失败：模块没有注册新的框架集成 provider`);
    }
    const info = {
        request: name,
        packageName: result.inspection.packageName,
        version: result.inspection.version,
        frameworkIds,
    };
    loaded.set(name, info);
    return { ...info, frameworkIds: [...frameworkIds] };
}

export async function loadFrameworkIntegrations(names: readonly string[]): Promise<string[]> {
    const failures: string[] = [];
    for (const name of [...new Set(names.map(item => item.trim()).filter(Boolean))]) {
        try {
            await loadFrameworkIntegration(name);
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
        }
    }
    return failures;
}
