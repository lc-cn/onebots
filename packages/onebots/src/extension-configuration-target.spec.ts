import { describe, expect, it } from "vitest";
import type { ExtensionCatalogEntry } from "./extension-catalog.js";
import { validateExtensionConfigurationTarget } from "./extension-configuration-target.js";

const entry = (overrides: Partial<ExtensionCatalogEntry> = {}): ExtensionCatalogEntry => ({
    id: "protocol:onebot-v11",
    type: "protocol",
    name: "onebot-v11",
    displayName: "OneBot v11",
    description: "test",
    packageName: "@onebots/protocol-onebot-v11",
    configurationTarget: { kind: "protocol", protocolKey: "onebot.v11" },
    setup: [],
    ...overrides,
});

describe("extension configuration target contract", () => {
    it("accepts matching adapter and protocol targets", () => {
        expect(validateExtensionConfigurationTarget(entry())).toBeNull();
        expect(
            validateExtensionConfigurationTarget(
                entry({
                    id: "adapter:telegram",
                    type: "adapter",
                    name: "telegram",
                    packageName: "@onebots/adapter-telegram",
                    configurationTarget: { kind: "account", platform: "telegram" },
                }),
            ),
        ).toBeNull();
    });

    it("rejects a catalog target that drifts from the promised extension identity", () => {
        expect(
            validateExtensionConfigurationTarget(
                entry({ configurationTarget: { kind: "protocol", protocolKey: "satori.v1" } }),
            ),
        ).toBe("协议 onebot-v11 的配置目标必须是 onebot.v11");
        expect(
            validateExtensionConfigurationTarget(
                entry({
                    type: "adapter",
                    name: "telegram",
                    configurationTarget: { kind: "account", platform: "discord" },
                }),
            ),
        ).toBe("适配器 telegram 的配置目标必须是同名账号平台");
    });

    it("rejects a protocol extension name without a version identity", () => {
        expect(validateExtensionConfigurationTarget(entry({ name: "custom" }))).toBe(
            "协议扩展名 custom 不符合 <name>-<version> 格式",
        );
    });
});
