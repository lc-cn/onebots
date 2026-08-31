import { AdapterRegistry, normalizeAdapterCapabilities, type Adapter } from "@onebots/core";
import { isDeepStrictEqual } from "node:util";

type AdapterInfoSource = Pick<Adapter, "describeCapabilities" | "info" | "platform">;

/** 将适配器运行态信息与注册表展示元数据合并为稳定的管理端摘要。 */
export function getAdapterInfo(adapter: AdapterInfoSource) {
    const info = adapter.info;
    const platform = String(adapter.platform);
    const metadata = AdapterRegistry.getMetadata(platform);
    const defaultCapabilities = normalizeAdapterCapabilities(info.capabilities);
    const accountCapabilities = Object.fromEntries(
        info.accounts.flatMap(account => {
            const capabilities = normalizeAdapterCapabilities(
                adapter.describeCapabilities(account.uin),
            );
            return isDeepStrictEqual(capabilities, defaultCapabilities)
                ? []
                : [[String(account.uin), capabilities]];
        }),
    );
    return {
        ...info,
        capabilities: defaultCapabilities,
        displayName: metadata?.displayName || platform,
        description: metadata?.description || "",
        accountCapabilities,
    };
}
