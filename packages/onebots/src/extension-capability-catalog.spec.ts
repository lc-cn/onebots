import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { EXTENSION_CATALOG } from "./extension-catalog.js";
import {
    getExtensionCapabilityCatalogPlatforms,
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
});
