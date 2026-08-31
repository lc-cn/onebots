import type { ExtensionCatalogEntry } from "./extension-catalog.js";
import { parseProtocolPluginIdentity } from "./protocol-plugin-identity.js";

export function validateExtensionConfigurationTarget(entry: ExtensionCatalogEntry): string | null {
    if (entry.type === "adapter") {
        if (
            entry.configurationTarget.kind !== "account" ||
            entry.configurationTarget.platform !== entry.name
        ) {
            return `适配器 ${entry.name} 的配置目标必须是同名账号平台`;
        }
        return null;
    }

    const identity = parseProtocolPluginIdentity(entry.name);
    if (!identity) return `协议扩展名 ${entry.name} 不符合 <name>-<version> 格式`;
    if (
        entry.configurationTarget.kind !== "protocol" ||
        entry.configurationTarget.protocolKey !== identity.schemaKey
    ) {
        return `协议 ${entry.name} 的配置目标必须是 ${identity.schemaKey}`;
    }
    return null;
}
