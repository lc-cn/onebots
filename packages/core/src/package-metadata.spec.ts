import { describe, expect, it } from "vitest";
import { readPackageVersion, readPackageVersionFile } from "./package-metadata.js";

describe("readPackageVersion", () => {
    it("从调用方模块位置读取所属包版本", async () => {
        await expect(readPackageVersion(import.meta.url)).resolves.toMatch(/^\d+\.\d+\.\d+/u);
    });

    it("支持读取已解析的底层依赖 package.json", async () => {
        await expect(
            readPackageVersionFile(new URL("../package.json", import.meta.url)),
        ).resolves.toMatch(/^\d+\.\d+\.\d+/u);
    });
});
