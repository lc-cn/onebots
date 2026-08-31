import { normalizeAdapterCapabilities, type AdapterCapabilityManifest } from "@onebots/core";
import snapshot from "./extension-capability-catalog.json" with { type: "json" };

export interface ExtensionCapabilityCatalogEntry {
    packageName: string;
    packageVersion: string;
    manifest: AdapterCapabilityManifest;
}

const entries = new Map<string, ExtensionCapabilityCatalogEntry>();
if (snapshot.schemaVersion !== 1) {
    throw new Error(`不支持的扩展能力目录版本: ${snapshot.schemaVersion}`);
}
for (const [platform, value] of Object.entries(snapshot.adapters)) {
    if (!value.packageName || !value.packageVersion) {
        throw new Error(`扩展能力目录 ${platform} 缺少包身份`);
    }
    entries.set(platform, {
        packageName: value.packageName,
        packageVersion: value.packageVersion,
        manifest: normalizeAdapterCapabilities(value.manifest as AdapterCapabilityManifest),
    });
}

/** 返回随当前 OneBots 版本发布的适配器能力快照。 */
export function getExtensionCapabilityCatalogEntry(
    platform: string,
): ExtensionCapabilityCatalogEntry | undefined {
    return entries.get(platform);
}

export function getExtensionCapabilityCatalogPlatforms(): string[] {
    return [...entries.keys()].sort();
}
