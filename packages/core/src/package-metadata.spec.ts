import { describe, expect, it } from "vitest";
import { readPackageVersion } from "./package-metadata.js";

describe("readPackageVersion", () => {
    it("从调用方模块位置读取所属包版本", async () => {
        await expect(readPackageVersion(import.meta.url)).resolves.toMatch(/^\d+\.\d+\.\d+/u);
    });
});
