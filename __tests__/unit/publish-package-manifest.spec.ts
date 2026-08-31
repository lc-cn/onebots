import { describe, expect, it } from "vitest";
import { publishedManifestErrors } from "../../scripts/publish-package-manifest.mjs";

describe("发布包 manifest 边界", () => {
    it("接受 pnpm 已改写为普通版本的最终清单", () => {
        const source = {
            name: "@onebots/protocol-example",
            version: "1.2.3",
            peerDependencies: { onebots: "workspace:*" },
            devDependencies: { onebots: "workspace:*", typescript: "catalog:" },
        };
        const published = {
            name: "@onebots/protocol-example",
            version: "1.2.3",
            peerDependencies: { onebots: "1.2.3" },
            devDependencies: { onebots: "1.2.3", typescript: "5.9.3" },
        };

        expect(publishedManifestErrors(source, published)).toEqual([]);
    });

    it.each([
        "catalog:",
        "workspace:*",
        "file:../core",
        "link:../core",
        "portal:../core",
        "patch:core@1.0.0#fix.patch",
    ])("拒绝消费者无法解析的本地协议 %s", version => {
        expect(
            publishedManifestErrors(
                { name: "example", version: "1.0.0" },
                {
                    name: "example",
                    version: "1.0.0",
                    devDependencies: { typescript: version },
                },
            ),
        ).toEqual([`发布清单 devDependencies.typescript 仍使用本地依赖协议 ${version}`]);
    });

    it.each(["dependencies", "peerDependencies", "optionalDependencies"])(
        "检查最终清单的 %s",
        field => {
            expect(
                publishedManifestErrors(
                    { name: "example", version: "1.0.0" },
                    {
                        name: "example",
                        version: "1.0.0",
                        [field]: { onebots: "workspace:*" },
                    },
                ),
            ).toEqual([`发布清单 ${field}.onebots 仍使用本地依赖协议 workspace:*`]);
        },
    );

    it("拒绝身份漂移和畸形依赖声明", () => {
        expect(
            publishedManifestErrors(
                { name: "expected", version: "1.0.0" },
                {
                    name: "substituted",
                    version: "2.0.0",
                    dependencies: { onebots: null },
                    optionalDependencies: [],
                },
            ),
        ).toEqual([
            '发布清单 name 错配，期望 "expected"，实际 "substituted"',
            '发布清单 version 错配，期望 "1.0.0"，实际 "2.0.0"',
            "发布清单 dependencies.onebots 必须是非空版本字符串",
            "发布清单 optionalDependencies 必须是依赖对象",
        ]);
    });
});
