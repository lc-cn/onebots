import {
    AdapterRegistry,
    normalizeAdapterCapabilities,
    type Adapter,
    type AdapterCapabilityManifest,
} from "@onebots/core";
import { isDeepStrictEqual } from "node:util";

type AdapterInfoSource = Pick<Adapter, "describeCapabilities" | "info" | "logger" | "platform">;

/** 将适配器运行态信息与注册表展示元数据合并为稳定的管理端摘要。 */
export function getAdapterInfo(adapter: AdapterInfoSource) {
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
        accountCapabilities,
        accountCapabilityErrors,
    };
}

function capabilityErrorMessage(error: unknown): string {
    if (!(error instanceof Error) || !error.message.trim()) {
        return "适配器未提供可用的账号能力清单";
    }
    return error.message.trim().slice(0, 500);
}
