import {
    AdapterRegistry,
    EMPTY_ADAPTER_CAPABILITIES,
    normalizeAdapterCapabilities,
    type Adapter,
    type AdapterCapabilityManifest,
} from "@onebots/core";
import { isDeepStrictEqual } from "node:util";

type AdapterInfoSource = Pick<Adapter, "describeCapabilities" | "info" | "logger" | "platform">;

export interface LoadedAdapterPlugin {
    type: "adapter" | "protocol";
    name: string;
    version: string | null;
}

/**
 * 合并账号运行态与插件加载证据。已加载但尚无账号的适配器也必须出现在管理 API，
 * 让首次配置和能力选型不依赖构造一个平台连接。
 */
export function getAdapterInfos(
    adapters: Iterable<AdapterInfoSource>,
    loadedPlugins: readonly LoadedAdapterPlugin[],
) {
    const adapterPlugins = new Map(
        loadedPlugins
            .filter(plugin => plugin.type === "adapter")
            .map(plugin => [plugin.name, plugin] as const),
    );
    const runtimeInfos = [...adapters].map(adapter =>
        getAdapterInfo(adapter, adapterPlugins.get(String(adapter.platform))?.version),
    );
    const runtimePlatforms = new Set(runtimeInfos.map(adapter => adapter.platform));
    const instanceLessInfos = [...adapterPlugins.values()].flatMap(plugin => {
        if (runtimePlatforms.has(plugin.name)) return [];
        const metadata = AdapterRegistry.getMetadata(plugin.name);
        const declared = metadata?.capabilities !== undefined;
        return [
            {
                platform: plugin.name,
                displayName: metadata?.displayName || plugin.name,
                description: metadata?.description || "",
                icon: metadata?.icon || "",
                capabilities: normalizeAdapterCapabilities(
                    metadata?.capabilities ?? EMPTY_ADAPTER_CAPABILITIES,
                ),
                capabilityDeclared: declared,
                capabilitySource: "runtime" as const,
                capabilityStatus: declared ? ("verified" as const) : ("unknown" as const),
                capabilityPackageVersion: plugin.version,
                accounts: [],
                accountCapabilities: {},
                accountCapabilityErrors: {},
            },
        ];
    });
    return [...runtimeInfos, ...instanceLessInfos];
}

/** 将适配器运行态信息与注册表展示元数据合并为稳定的管理端摘要。 */
export function getAdapterInfo(adapter: AdapterInfoSource, packageVersion: string | null = null) {
    const info = adapter.info;
    const platform = String(adapter.platform);
    const metadata = AdapterRegistry.getMetadata(platform);
    const defaultCapabilities = normalizeAdapterCapabilities(info.capabilities);
    const accountCapabilities: Record<string, AdapterCapabilityManifest> = {};
    const accountCapabilityErrors: Record<
        string,
        { code: "capability_unavailable"; message: string }
    > = {};
    for (const account of info.accounts) {
        const accountId = String(account.uin);
        try {
            const capabilities = normalizeAdapterCapabilities(
                adapter.describeCapabilities(account.uin),
            );
            if (!isDeepStrictEqual(capabilities, defaultCapabilities)) {
                accountCapabilities[accountId] = capabilities;
            }
        } catch (error) {
            adapter.logger.error(`账号 ${accountId} 的能力清单不可用`, error);
            accountCapabilityErrors[accountId] = {
                code: "capability_unavailable",
                message: capabilityErrorMessage(error),
            };
        }
    }
    return {
        ...info,
        capabilities: defaultCapabilities,
        displayName: metadata?.displayName || platform,
        description: metadata?.description || "",
        capabilityDeclared:
            metadata?.capabilities !== undefined || hasDeclaredCapabilities(defaultCapabilities),
        capabilitySource: "runtime" as const,
        capabilityStatus:
            metadata?.capabilities !== undefined || hasDeclaredCapabilities(defaultCapabilities)
                ? ("verified" as const)
                : ("unknown" as const),
        capabilityPackageVersion: packageVersion,
        accountCapabilities,
        accountCapabilityErrors,
    };
}

function hasDeclaredCapabilities(capabilities: AdapterCapabilityManifest): boolean {
    return [
        capabilities.actions,
        capabilities.events,
        capabilities.segments,
        capabilities.transports,
    ].some(category => Object.keys(category).length > 0);
}

function capabilityErrorMessage(error: unknown): string {
    if (!(error instanceof Error) || !error.message.trim()) {
        return "适配器未提供可用的账号能力清单";
    }
    return error.message.trim().slice(0, 500);
}
