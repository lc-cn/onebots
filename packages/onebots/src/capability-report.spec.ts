import { afterEach, describe, expect, it } from "vitest";
import {
    AdapterRegistry,
    defineAdapterCapabilities,
    type Adapter,
    type Schema,
} from "@onebots/core";
import {
    buildAdapterCapabilityReport,
    formatAdapterCapabilityReport,
} from "./capability-report.js";
import type { LoadedPluginInfo } from "./plugin-loader.js";

const schema: Schema = {
    token: {
        type: "string",
        label: "Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
};

afterEach(() => AdapterRegistry.clear());

describe("adapter capability report", () => {
    it("exports package evidence, support counts and the complete manifest", () => {
        const capabilities = defineAdapterCapabilities({
            actions: {
                send_message: { support: "native" },
                delete_message: { support: "emulated" },
                set_group_name: { support: "unsupported" },
            },
            events: { message: { support: "native" } },
            segments: { text: { support: "native", direction: "both" } },
            transports: { webhook: { support: "native", mode: "webhook" } },
        });
        AdapterRegistry.register("example", (() => undefined) as unknown as Adapter.Factory, {
            displayName: "示例平台",
            description: "示例适配器",
            capabilities,
        });
        AdapterRegistry.registerSchema("example", schema);

        const report = buildAdapterCapabilityReport([plugin("example")]);

        expect(report).toMatchObject({
            complete: true,
            errors: [],
            adapters: [
                {
                    source: "runtime",
                    name: "example",
                    displayName: "示例平台",
                    packageName: "@onebots/adapter-example",
                    packageVersion: "1.2.3",
                    declared: true,
                    summary: {
                        actions: {
                            total: 3,
                            supported: 2,
                            native: 1,
                            emulated: 1,
                            unsupported: 1,
                        },
                    },
                    capabilities,
                },
            ],
        });
        expect(formatAdapterCapabilityReport(report)).toContain(
            "动作 2/3（原生 1，模拟 1，不支持 1）",
        );
        expect(JSON.parse(formatAdapterCapabilityReport(report, true))).toEqual(report);
    });

    it("exports versioned catalog snapshots without loading an adapter", () => {
        const report = buildAdapterCapabilityReport([], [], ["slack"]);

        expect(report).toMatchObject({
            complete: true,
            errors: [],
            adapters: [
                {
                    source: "catalog",
                    name: "slack",
                    displayName: "Slack",
                    packageName: "@onebots/adapter-slack",
                    packageVersion: expect.any(String),
                    entryPath: null,
                    declared: true,
                    capabilities: expect.any(Object),
                },
            ],
        });
        expect(formatAdapterCapabilityReport(report)).toContain("目录快照");
        expect(formatAdapterCapabilityReport(report)).toContain("不代表适配器已安装或账号已授权");
    });

    it("gives a loaded runtime manifest precedence over its catalog snapshot", () => {
        const capabilities = defineAdapterCapabilities({
            actions: {},
            events: {},
            segments: {},
            transports: {},
        });
        AdapterRegistry.register("slack", (() => undefined) as unknown as Adapter.Factory, {
            capabilities,
        });
        AdapterRegistry.registerSchema("slack", schema);

        const report = buildAdapterCapabilityReport([plugin("slack")], [], ["slack"]);

        expect(report.adapters).toHaveLength(1);
        expect(report.adapters[0]).toMatchObject({
            source: "runtime",
            packageVersion: "1.2.3",
            entryPath: "/runtime/slack/index.js",
            capabilities,
        });
    });

    it("makes an undeclared third-party boundary machine visible", () => {
        AdapterRegistry.register("third-party", (() => undefined) as unknown as Adapter.Factory);
        AdapterRegistry.registerSchema("third-party", schema);

        const report = buildAdapterCapabilityReport([plugin("third-party")]);

        expect(report).toMatchObject({
            complete: false,
            adapters: [{ name: "third-party", declared: false, capabilities: null }],
        });
        expect(formatAdapterCapabilityReport(report)).toContain("未声明默认能力清单");
    });

    it("keeps plugin load failures in JSON and human reports", () => {
        const report = buildAdapterCapabilityReport([], ["adapter:missing"]);

        expect(report).toEqual({ complete: false, errors: ["adapter:missing"], adapters: [] });
        expect(formatAdapterCapabilityReport(report)).toBe("✗ 加载失败: adapter:missing");
        expect(JSON.parse(formatAdapterCapabilityReport(report, true))).toEqual(report);
    });
});

function plugin(name: string): LoadedPluginInfo {
    return {
        type: "adapter",
        name,
        packageName: `@onebots/adapter-${name}`,
        version: "1.2.3",
        entryPath: `/runtime/${name}/index.js`,
    };
}
