import { describe, expect, it, vi } from "vitest";
import {
    assertUpdatedPackageVersions,
    rollbackUpdatedPackages,
} from "./update-package-transaction.js";

describe("update package transaction", () => {
    it("在服务切换前恢复旧版本并移除原本不存在的包", () => {
        const versions = new Map<string, string | null>([
            ["onebots", "1.3.0"],
            ["@onebots/adapter-mock", "2.4.0"],
        ]);
        const execute = vi.fn(invocation => {
            if (invocation.args[0] === "up") versions.set("onebots", "1.2.8");
            if (invocation.args[0] === "remove") versions.set("@onebots/adapter-mock", null);
        });

        rollbackUpdatedPackages(
            [
                { name: "onebots", current: "1.2.8" },
                { name: "@onebots/adapter-mock", current: null },
            ],
            process.cwd(),
            process.cwd(),
            name => versions.get(name) ?? null,
            execute,
        );

        expect(execute.mock.calls.map(([invocation]) => invocation.args)).toEqual([
            ["up", "onebots@1.2.8"],
            ["remove", "@onebots/adapter-mock"],
        ]);
    });

    it("恢复命令成功但清单不符时保留完整证据", () => {
        expect(() =>
            rollbackUpdatedPackages(
                [{ name: "onebots", current: "1.2.8" }],
                process.cwd(),
                process.cwd(),
                () => "1.3.0",
                () => undefined,
            ),
        ).toThrow("onebots 期望恢复为 1.2.8，实际 1.3.0");
    });

    it("更新版本校验报告所有偏离项", () => {
        const versions = new Map([
            ["onebots", "1.2.9"],
            ["@onebots/adapter-mock", null],
        ]);
        expect(() =>
            assertUpdatedPackageVersions(
                [
                    { name: "onebots", target: "1.3.0" },
                    { name: "@onebots/adapter-mock", target: "2.4.0" },
                ],
                "/runtime",
                name => versions.get(name) ?? null,
            ),
        ).toThrow(
            "包更新版本校验失败：onebots 期望 1.3.0，实际 1.2.9；@onebots/adapter-mock 期望 2.4.0，实际 未安装。服务预检、定义改写与重启均未执行",
        );
    });
});
