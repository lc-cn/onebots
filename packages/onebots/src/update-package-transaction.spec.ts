import { describe, expect, it, vi } from "vitest";
import {
    assertUpdatedPackageVersions,
    recoverPackagesAfterFailedUpdate,
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

    it("包管理器失败但已部分更新时恢复整组依赖", () => {
        const versions = new Map<string, string | null>([
            ["onebots", "1.3.0"],
            ["@onebots/adapter-mock", "2.3.0"],
        ]);
        const execute = vi.fn(invocation => {
            if (invocation.args[0] === "up") {
                versions.set("onebots", "1.2.8");
                versions.set("@onebots/adapter-mock", "2.3.0");
            }
        });

        expect(() =>
            recoverPackagesAfterFailedUpdate(
                [
                    { name: "onebots", current: "1.2.8" },
                    { name: "@onebots/adapter-mock", current: "2.3.0" },
                ],
                "/runtime",
                "/runtime",
                name => versions.get(name) ?? null,
                new Error("postinstall failed"),
                { execute },
            ),
        ).toThrow(/已恢复更新前依赖.*postinstall failed/);
        expect(execute).toHaveBeenCalledOnce();
        expect(versions.get("onebots")).toBe("1.2.8");
    });

    it("包管理器失败且未改写版本时保留原错误且不做反向安装", () => {
        const original = new Error("registry unavailable");
        const execute = vi.fn();

        expect(() =>
            recoverPackagesAfterFailedUpdate(
                [{ name: "onebots", current: "1.2.8" }],
                "/runtime",
                "/runtime",
                () => "1.2.8",
                original,
                { execute },
            ),
        ).toThrow(original);
        expect(execute).not.toHaveBeenCalled();
    });

    it("包管理器部分更新与恢复同时失败时保留双方证据", () => {
        expect(() =>
            recoverPackagesAfterFailedUpdate(
                [{ name: "onebots", current: "1.2.8" }],
                "/runtime",
                "/runtime",
                () => "1.3.0",
                new Error("install timeout"),
                {
                    execute: () => {
                        throw new Error("lockfile readonly");
                    },
                },
            ),
        ).toThrow(/包管理器执行失败且依赖恢复失败.*install timeout.*lockfile readonly/);
    });

    it("仅依赖声明或锁文件变化时也恢复整组依赖", () => {
        const execute = vi.fn();
        const verifyMetadata = vi.fn();

        expect(() =>
            recoverPackagesAfterFailedUpdate(
                [{ name: "onebots", current: "1.2.8" }],
                "/runtime",
                "/runtime",
                () => "1.2.8",
                new Error("lockfile write interrupted"),
                { metadataChanged: true, execute, verifyMetadata },
            ),
        ).toThrow(/已恢复更新前依赖.*lockfile write interrupted/);
        expect(execute).toHaveBeenCalledOnce();
        expect(verifyMetadata).toHaveBeenCalledOnce();
    });

    it("包版本恢复但依赖元数据仍漂移时报告恢复失败", () => {
        expect(() =>
            recoverPackagesAfterFailedUpdate(
                [{ name: "onebots", current: "1.2.8" }],
                "/runtime",
                "/runtime",
                () => "1.2.8",
                new Error("lockfile write interrupted"),
                {
                    metadataChanged: true,
                    execute: () => undefined,
                    verifyMetadata: () => {
                        throw new Error("lockfile still changed");
                    },
                },
            ),
        ).toThrow(
            /包管理器执行失败且依赖恢复失败.*lockfile write interrupted.*lockfile still changed/,
        );
    });
});
