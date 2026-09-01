import type { ExtensionCatalogEntry } from "./extension-catalog.js";
import { TRUSTED_EXTENSION_CATALOG } from "./trusted-extension-catalog.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionCapabilityCatalogPlatforms,
    getExtensionPackageCatalogEntry,
    getExtensionPackageCatalogNames,
    type ExtensionCapabilityCatalogEntry,
    type ExtensionPackageCatalogEntry,
} from "./extension-capability-catalog.js";

export interface ExtensionCatalogIntegritySource {
    packageNames(): string[];
    capabilityPlatforms(): string[];
    packageEntry(packageName: string): ExtensionPackageCatalogEntry | undefined;
    capabilityEntry(platform: string): ExtensionCapabilityCatalogEntry | undefined;
}

const DEFAULT_SOURCE: ExtensionCatalogIntegritySource = {
    packageNames: getExtensionPackageCatalogNames,
    capabilityPlatforms: getExtensionCapabilityCatalogPlatforms,
    packageEntry: getExtensionPackageCatalogEntry,
    capabilityEntry: getExtensionCapabilityCatalogEntry,
};

/** 校验安装白名单、固定包版本与适配器能力快照形成闭合集合。 */
export function validateExtensionCatalogIntegrity(
    entries: readonly ExtensionCatalogEntry[] = TRUSTED_EXTENSION_CATALOG,
    source: ExtensionCatalogIntegritySource = DEFAULT_SOURCE,
): string[] {
    const issues: string[] = [];
    const expectedIds = new Set<string>();
    const expectedPackages = new Set<string>();
    const expectedAdapters = new Set<string>();

    for (const entry of entries) {
        if (expectedIds.has(entry.id)) issues.push(`扩展目录 ID 重复: ${entry.id}`);
        expectedIds.add(entry.id);
        if (expectedPackages.has(entry.packageName)) {
            issues.push(`扩展目录包名重复: ${entry.packageName}`);
        }
        expectedPackages.add(entry.packageName);

        const packageEntry = source.packageEntry(entry.packageName);
        if (!packageEntry) {
            issues.push(`扩展包版本目录缺失: ${entry.packageName}`);
        } else if (packageEntry.packageName !== entry.packageName) {
            issues.push(
                `扩展包版本目录身份错配: ${entry.packageName} 实际指向 ${packageEntry.packageName}`,
            );
        }

        if (entry.type !== "adapter") continue;
        expectedAdapters.add(entry.name);
        const capability = source.capabilityEntry(entry.name);
        if (!capability) {
            issues.push(`适配器能力快照缺失: ${entry.name}`);
            continue;
        }
        if (capability.packageName !== entry.packageName) {
            issues.push(
                `适配器能力快照包名错配: ${entry.name} 应为 ${entry.packageName}，实际为 ${capability.packageName}`,
            );
        }
        if (packageEntry && capability.packageVersion !== packageEntry.packageVersion) {
            issues.push(
                `适配器能力快照版本错配: ${entry.name} 为 ${capability.packageVersion}，固定版本为 ${packageEntry.packageVersion}`,
            );
        }
    }

    for (const packageName of [...new Set(source.packageNames())].sort()) {
        if (!expectedPackages.has(packageName)) {
            issues.push(`扩展包版本目录存在孤立项: ${packageName}`);
        }
    }
    for (const platform of [...new Set(source.capabilityPlatforms())].sort()) {
        if (!expectedAdapters.has(platform)) {
            issues.push(`适配器能力目录存在孤立项: ${platform}`);
        }
    }
    return issues;
}

export function getInstallableAdapterNames(
    entries: readonly ExtensionCatalogEntry[] = TRUSTED_EXTENSION_CATALOG,
): string[] {
    return entries
        .filter(entry => entry.type === "adapter")
        .map(entry => entry.name)
        .sort();
}
