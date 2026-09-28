import { describe, expect, it } from "vitest";
import { buildExtensionTabs, protocolKeyForPackage } from "./extension-tabs.js";

describe("扩展分类", () => {
    it("已安装平台即使没有账号也显示，并保留目录外的旧账号", () => {
        expect(
            buildExtensionTabs(
                ["qq", "mock"],
                [{ name: "qq", displayName: "QQ" }],
                ["qq", "legacy", "legacy"],
            ),
        ).toEqual([
            { key: "qq", label: "QQ", installed: true, count: 1 },
            { key: "mock", label: "mock", installed: true, count: 0 },
            { key: "legacy", label: "legacy", installed: false, count: 2 },
        ]);
    });

    it("按配置中的协议键合并安装项与出口", () => {
        expect(
            buildExtensionTabs(
                ["onebot-v11", "milky-v1"],
                [{ name: "onebot-v11", displayName: "OneBot 11" }],
                ["onebot.v11", "satori.v1"],
                protocolKeyForPackage,
            ),
        ).toEqual([
            { key: "onebot.v11", label: "OneBot 11", installed: true, count: 1 },
            { key: "milky.v1", label: "milky-v1", installed: true, count: 0 },
            { key: "satori.v1", label: "satori.v1", installed: false, count: 1 },
        ]);
    });
});
