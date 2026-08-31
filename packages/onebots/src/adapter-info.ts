import { AdapterRegistry, type Adapter } from "@onebots/core";

type AdapterInfoSource = Pick<Adapter, "info" | "platform">;

/** 将适配器运行态信息与注册表展示元数据合并为稳定的管理端摘要。 */
export function getAdapterInfo(adapter: AdapterInfoSource) {
    const info = adapter.info;
    const platform = String(adapter.platform);
    const metadata = AdapterRegistry.getMetadata(platform);
    return {
        ...info,
        displayName: metadata?.displayName || platform,
        description: metadata?.description || "",
    };
}
