import { describe, expect, it } from "vitest";
import { inspectExtensionCatalog } from "./doctor-extension-catalog.js";
import { EXTENSION_CATALOG, type ExtensionCatalogEntry } from "./extension-catalog.js";

describe("doctor extension catalog", () => {
    it("proves every shipped configuration target", () => {
        const adapters = EXTENSION_CATALOG.filter(entry => entry.type === "adapter").length;
        const protocols = EXTENSION_CATALOG.length - adapters;

        expect(inspectExtensionCatalog()).toEqual({
            name: "extension-catalog",
            level: "ok",
            message: `扩展目录闭合有效：${adapters} 个适配器，${protocols} 个协议`,
        });
    });

    it("reports every invalid entry instead of stopping at the first one", () => {
        const adapter = findEntry("adapter:slack");
        const protocol = findEntry("protocol:onebot-v11");
        const entries: ExtensionCatalogEntry[] = [
            {
                ...adapter,
                configurationTarget: { kind: "account", platform: "telegram" },
            },
            {
                ...protocol,
                configurationTarget: { kind: "protocol", protocolKey: "onebot.v12" },
            },
        ];

        expect(inspectExtensionCatalog(entries, [])).toEqual({
            name: "extension-catalog",
            level: "error",
            message:
                "发现 2 个扩展目录问题：adapter:slack: 适配器 slack 的配置目标必须是同名账号平台；protocol:onebot-v11: 协议 onebot-v11 的配置目标必须是 onebot.v11",
        });
    });

    it("fails the machine-readable check when catalog coverage drifts", () => {
        expect(inspectExtensionCatalog(EXTENSION_CATALOG, ["适配器能力快照缺失: slack"])).toEqual({
            name: "extension-catalog",
            level: "error",
            message: "发现 1 个扩展目录问题：适配器能力快照缺失: slack",
        });
    });
});

function findEntry(id: string): ExtensionCatalogEntry {
    const entry = EXTENSION_CATALOG.find(candidate => candidate.id === id);
    if (!entry) throw new Error(`测试扩展不存在: ${id}`);
    return entry;
}
