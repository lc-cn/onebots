import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { EXTENSION_CATALOG } from "./extension-catalog.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionCapabilityCatalogPlatforms,
    getExtensionPackageCatalogEntry,
    getExtensionPackageCatalogNames,
} from "./extension-capability-catalog.js";

const execFileAsync = promisify(execFile);

describe("extension capability catalog", () => {
    it("covers every installable adapter and stays aligned with built manifests", async () => {
        const expected = EXTENSION_CATALOG.filter(entry => entry.type === "adapter")
            .map(entry => entry.name)
            .sort();

        expect(getExtensionCapabilityCatalogPlatforms()).toEqual(expected);
        expect(getExtensionPackageCatalogNames()).toEqual(
            EXTENSION_CATALOG.map(entry => entry.packageName).sort(),
        );
        await expect(
            execFileAsync(
                process.execPath,
                ["scripts/generate-extension-capability-catalog.mjs", "--check"],
                { cwd: process.cwd() },
            ),
        ).resolves.toMatchObject({ stderr: "" });
    });

    it("returns frozen package and capability identities", () => {
        const extension = EXTENSION_CATALOG[0];
        const packageEntry = getExtensionPackageCatalogEntry(extension.packageName);
        const capabilityEntry =
            extension.type === "adapter"
                ? getExtensionCapabilityCatalogEntry(extension.name)
                : undefined;
        if (!packageEntry || !capabilityEntry) throw new Error("测试目录项缺失");

        expect(Object.isFrozen(packageEntry)).toBe(true);
        expect(Object.isFrozen(capabilityEntry)).toBe(true);
        expect(Object.isFrozen(capabilityEntry.manifest)).toBe(true);
        expect(() => {
            packageEntry.packageVersion = "9.9.9";
        }).toThrow(TypeError);
        expect(() => {
            capabilityEntry.packageName = "malicious-package";
        }).toThrow(TypeError);
    });
});
