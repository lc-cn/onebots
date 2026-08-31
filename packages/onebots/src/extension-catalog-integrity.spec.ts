import { EMPTY_ADAPTER_CAPABILITIES } from "@onebots/core";
import { describe, expect, it } from "vitest";
import {
    type ExtensionCatalogIntegritySource,
    validateExtensionCatalogIntegrity,
} from "./extension-catalog-integrity.js";
import { EXTENSION_CATALOG, type ExtensionCatalogEntry } from "./extension-catalog.js";

describe("extension catalog integrity", () => {
    it("proves the shipped install, version and capability catalogs form one closed set", () => {
        expect(validateExtensionCatalogIntegrity()).toEqual([]);
    });

    it("collects missing and orphaned entries across both published catalogs", () => {
        const adapter = findEntry("adapter:slack");
        const protocol = findEntry("protocol:onebot-v11");
        const source: ExtensionCatalogIntegritySource = {
            packageNames: () => [adapter.packageName, "@onebots/adapter-orphan"],
            capabilityPlatforms: () => ["orphan"],
            packageEntry: packageName =>
                packageName === adapter.packageName
                    ? { packageName, packageVersion: "1.0.0" }
                    : undefined,
            capabilityEntry: () => undefined,
        };

        expect(validateExtensionCatalogIntegrity([adapter, protocol], source)).toEqual([
            "适配器能力快照缺失: slack",
            "扩展包版本目录缺失: @onebots/protocol-onebot-v11",
            "扩展包版本目录存在孤立项: @onebots/adapter-orphan",
            "适配器能力目录存在孤立项: orphan",
        ]);
    });

    it("rejects snapshot package identity and version drift", () => {
        const adapter = findEntry("adapter:slack");
        const source: ExtensionCatalogIntegritySource = {
            packageNames: () => [adapter.packageName],
            capabilityPlatforms: () => [adapter.name],
            packageEntry: packageName => ({ packageName, packageVersion: "1.2.3" }),
            capabilityEntry: () => ({
                packageName: "@onebots/adapter-telegram",
                packageVersion: "1.2.2",
                manifest: EMPTY_ADAPTER_CAPABILITIES,
            }),
        };

        expect(validateExtensionCatalogIntegrity([adapter], source)).toEqual([
            "适配器能力快照包名错配: slack 应为 @onebots/adapter-slack，实际为 @onebots/adapter-telegram",
            "适配器能力快照版本错配: slack 为 1.2.2，固定版本为 1.2.3",
        ]);
    });
});

function findEntry(id: string): ExtensionCatalogEntry {
    const entry = EXTENSION_CATALOG.find(candidate => candidate.id === id);
    if (!entry) throw new Error(`测试扩展不存在: ${id}`);
    return entry;
}
