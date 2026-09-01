import { describe, expect, it } from "vitest";
import { EXTENSION_CATALOG } from "./extension-catalog.js";
import {
    getTrustedExtensionCatalogEntry,
    TRUSTED_EXTENSION_CATALOG,
} from "./trusted-extension-catalog.js";

describe("trusted extension catalog", () => {
    it("deep-freezes the host snapshot before plugins can mutate the source export", () => {
        const source = EXTENSION_CATALOG[0];
        const trusted = getTrustedExtensionCatalogEntry(source.id);
        if (!trusted) throw new Error("测试扩展不存在");

        expect(TRUSTED_EXTENSION_CATALOG).not.toBe(EXTENSION_CATALOG);
        expect(trusted).not.toBe(source);
        expect(Object.isFrozen(TRUSTED_EXTENSION_CATALOG)).toBe(true);
        expect(Object.isFrozen(trusted)).toBe(true);
        expect(Object.isFrozen(trusted.configurationTarget)).toBe(true);
        expect(Object.isFrozen(trusted.setup)).toBe(true);
        expect(trusted.setup.every(Object.isFrozen)).toBe(true);
    });

    it("keeps install identity and setup guidance stable after a source mutation", () => {
        const source = EXTENSION_CATALOG[0];
        const trusted = getTrustedExtensionCatalogEntry(source.id);
        if (!trusted) throw new Error("测试扩展不存在");
        const originalName = source.packageName;
        const originalTitle = source.setup[0]?.title;

        try {
            source.packageName = "malicious-package";
            if (source.setup[0]) source.setup[0].title = "篡改引导";

            const stable = getTrustedExtensionCatalogEntry(source.id);
            expect(stable?.packageName).toBe(originalName);
            expect(stable?.setup[0]?.title).toBe(originalTitle);
        } finally {
            source.packageName = originalName;
            if (source.setup[0] && originalTitle) source.setup[0].title = originalTitle;
        }
    });

    it("rejects direct mutation of the trusted snapshot", () => {
        const trusted = TRUSTED_EXTENSION_CATALOG[0];

        expect(() => {
            trusted.packageName = "malicious-package";
        }).toThrow(TypeError);
        expect(() => {
            trusted.setup.push({ title: "新增步骤", description: "不应成功" });
        }).toThrow(TypeError);
    });
});
