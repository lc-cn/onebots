import { describe, expect, it } from "vitest";
import type { ControlAdapterCatalogEntry } from "@onebots/core/control";
import { groupAdapterCatalog, selectedAdapterEntries } from "./control-adapter-catalog.js";

const adapter = (
    name: string,
    requirements: ControlAdapterCatalogEntry["requirements"] = [],
): ControlAdapterCatalogEntry => ({
    name,
    displayName: name === "mock" ? "模拟平台" : name.toUpperCase(),
    description: `${name} description`,
    packageName: `@onebots/adapter-${name}`,
    version: "1.0.0",
    setup: [{ title: "准备应用", description: "创建机器人" }],
    requirements,
    peerDependencies: [],
    capabilitySnapshot: {
        packageVersion: "1.0.0",
        summary: {
            actions: { total: 1, supported: 1, native: 1, emulated: 0, unsupported: 0 },
            events: { total: 0, supported: 0, native: 0, emulated: 0, unsupported: 0 },
            segments: { total: 0, supported: 0, native: 0, emulated: 0, unsupported: 0 },
            transports: { total: 0, supported: 0, native: 0, emulated: 0, unsupported: 0 },
        },
        manifest: {
            version: 1,
            actions: { send_message: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        },
    },
});

describe("adapter capability catalog presentation", () => {
    const entries = [
        adapter("mock"),
        adapter("telegram"),
        adapter("icqq", [
            {
                kind: "registry-authentication",
                title: "GitHub Packages",
                description: "临时下载授权",
                scope: "@icqqjs",
                permission: "read:packages",
            },
        ]),
    ];

    it("在没有账号信息时按安装前置条件分组", () => {
        expect(
            groupAdapterCatalog(entries, "").map(group => [group.key, group.entries.length]),
        ).toEqual([
            ["local", 1],
            ["platform", 1],
            ["private", 1],
        ]);
    });

    it("可按能力名、包名和下载授权搜索", () => {
        expect(
            groupAdapterCatalog(entries, "send_message").flatMap(group => group.entries),
        ).toHaveLength(3);
        expect(groupAdapterCatalog(entries, "read:packages")[0].entries[0].name).toBe("icqq");
        expect(groupAdapterCatalog(entries, "adapter-telegram")[0].entries[0].name).toBe(
            "telegram",
        );
        expect(groupAdapterCatalog(entries, "missing")).toEqual([]);
    });

    it("已选摘要沿用目录顺序且忽略目录外名称", () => {
        expect(
            selectedAdapterEntries(entries, ["icqq", "missing", "mock"]).map(item => item.name),
        ).toEqual(["mock", "icqq"]);
    });

    it("兼容旧服务返回的基础三字段目录", () => {
        const legacy: ControlAdapterCatalogEntry = {
            name: "legacy",
            displayName: "Legacy",
            version: "1.0.0",
        };
        expect(groupAdapterCatalog([legacy], "legacy")[0].entries).toEqual([legacy]);
        expect(groupAdapterCatalog([legacy], "send_message")).toEqual([]);
    });
});
