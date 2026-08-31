import { describe, expect, it } from "vitest";
import { getExtensionInstallationAction } from "./extension-installation.js";

describe("extension installation action", () => {
    it("blocks installation when the server cannot prove catalog integrity", () => {
        expect(
            getExtensionInstallationAction({
                catalogError: "适配器能力快照缺失: slack",
                installed: false,
                targetVersion: "1.2.3",
                versionAligned: false,
            }),
        ).toEqual({ available: false, label: "目录校验失败" });
    });

    it("blocks an entry without a verified target version", () => {
        expect(
            getExtensionInstallationAction({
                catalogError: null,
                installed: false,
                targetVersion: null,
                versionAligned: false,
            }),
        ).toEqual({ available: false, label: "验证版本不可用" });
    });

    it("keeps the normal install and version-alignment actions", () => {
        expect(
            getExtensionInstallationAction({
                catalogError: null,
                installed: false,
                targetVersion: "1.2.3",
                versionAligned: false,
            }),
        ).toEqual({ available: true, label: "安装 v1.2.3 并重启" });
        expect(
            getExtensionInstallationAction({
                catalogError: null,
                installed: true,
                targetVersion: "1.2.3",
                versionAligned: false,
            }),
        ).toEqual({ available: true, label: "切换至 v1.2.3 并重启" });
    });
});
