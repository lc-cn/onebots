import { describe, expect, it } from "vitest";
import type { AdapterCapabilityManifest } from "@onebots/core";
import {
    capabilityAvailabilityLabel,
    capabilityDirectionLabel,
    capabilitySceneLabel,
    capabilitySupportLabel,
    countSupportedCapabilities,
    getCapabilityEntries,
    hasAccountCapabilityOverride,
    mergeCapabilityReportAdapters,
    parseAdapterCapabilityReport,
    resolveAccountCapabilityError,
    resolveAccountCapabilities,
} from "./capability-presentation.js";
import type { AdapterCapabilityReport, AdapterInfo } from "../types";

const manifest: AdapterCapabilityManifest = {
    version: 1,
    actions: {
        z_action: { support: "unsupported" },
        emulate_action: { support: "emulated" },
        native_action: { support: "native" },
    },
    events: {},
    segments: {},
    transports: {},
};

describe("capability presentation", () => {
    it("publishes exhaustive human labels for manifest evidence", () => {
        expect(
            (["native", "emulated", "unsupported"] as const).map(capabilitySupportLabel),
        ).toEqual(["原生", "模拟", "不支持"]);
        expect(
            (["always", "permission", "context"] as const).map(capabilityAvailabilityLabel),
        ).toEqual(["始终可用", "需要权限", "依赖上下文"]);
        expect((["send", "receive", "both"] as const).map(capabilityDirectionLabel)).toEqual([
            "发送",
            "接收",
            "双向",
        ]);
        expect(
            (["private", "group", "channel", "direct"] as const).map(capabilitySceneLabel),
        ).toEqual(["私聊", "群聊", "频道", "直接会话"]);
    });

    it("keeps unsupported declarations visible but excludes them from the supported count", () => {
        expect(getCapabilityEntries(manifest, "actions").map(entry => entry.name)).toEqual([
            "native_action",
            "emulate_action",
            "z_action",
        ]);
        expect(countSupportedCapabilities(manifest, "actions")).toBe(2);
    });

    it("uses a sparse account override and otherwise falls back to the adapter manifest", () => {
        const accountManifest: AdapterCapabilityManifest = {
            ...manifest,
            actions: { native_action: { support: "unsupported" } },
        };
        const adapter = {
            capabilities: manifest,
            accountCapabilities: { limited: accountManifest },
        };

        expect(resolveAccountCapabilities(adapter, "limited")).toBe(accountManifest);
        expect(resolveAccountCapabilities(adapter, "default")).toBe(manifest);
        expect(hasAccountCapabilityOverride(adapter, "limited")).toBe(true);
        expect(hasAccountCapabilityOverride(adapter, "default")).toBe(false);
    });

    it("keeps an unavailable account manifest distinct from a real override", () => {
        const error = { code: "capability_unavailable" as const, message: "清单无效" };
        const adapter = {
            capabilities: manifest,
            accountCapabilities: {},
            accountCapabilityErrors: { broken: error },
        };

        expect(resolveAccountCapabilities(adapter, "broken")).toBe(manifest);
        expect(hasAccountCapabilityOverride(adapter, "broken")).toBe(false);
        expect(resolveAccountCapabilityError(adapter, "broken")).toBe(error);
        expect(resolveAccountCapabilityError(adapter, "default")).toBeUndefined();
    });

    it("adds catalog manifests without an account and keeps runtime evidence authoritative", () => {
        const runtimeAdapter = {
            platform: "telegram",
            displayName: "Telegram runtime",
            description: "runtime",
            icon: "telegram.svg",
            capabilities: manifest,
            accounts: [],
        } satisfies AdapterInfo;
        const report = capabilityReport([
            reportAdapter("telegram", manifest, "runtime"),
            reportAdapter("discord", manifest),
            reportAdapter("undeclared", null, "catalog", "unavailable"),
        ]);

        const result = mergeCapabilityReportAdapters([runtimeAdapter], report);

        expect(result.map(adapter => adapter.platform)).toEqual([
            "telegram",
            "discord",
            "undeclared",
        ]);
        expect(result[0]).toMatchObject({
            displayName: "Telegram runtime",
            capabilityDeclared: true,
            capabilitySource: "runtime",
            capabilityPackageVersion: "1.2.3",
        });
        expect(result[1]).toMatchObject({
            displayName: "discord catalog",
            capabilityDeclared: true,
            capabilitySource: "catalog",
            capabilityPackageVersion: "1.2.3",
            accounts: [],
            capabilities: manifest,
        });
        expect(result[2]).toMatchObject({
            displayName: "undeclared catalog",
            capabilityDeclared: false,
            capabilitySource: "catalog",
            capabilityStatus: "unavailable",
            capabilities: {
                version: 1,
                actions: {},
                events: {},
                segments: {},
                transports: {},
            },
            accounts: [],
        });
    });

    it("rejects malformed independent capability API responses", () => {
        expect(() => parseAdapterCapabilityReport(null)).toThrow("必须是对象");
        expect(() =>
            parseAdapterCapabilityReport({
                ...capabilityReport([]),
                application: { name: "onebots", version: "1.2.8" },
            }),
        ).toThrow("响应结构无效");
        expect(() =>
            parseAdapterCapabilityReport({ ...capabilityReport([]), adapters: [{}] }),
        ).toThrow("条目结构无效");
        expect(parseAdapterCapabilityReport(capabilityReport([]))).toEqual(capabilityReport([]));
    });

    it("preserves an unversioned runtime warning over the account API manifest status", () => {
        const runtimeAdapter = {
            platform: "custom",
            displayName: "Custom",
            description: "runtime",
            icon: "",
            capabilities: manifest,
            capabilityDeclared: true,
            capabilitySource: "runtime" as const,
            capabilityStatus: "verified" as const,
            accounts: [],
        } satisfies AdapterInfo;
        const report = capabilityReport([
            { ...reportAdapter("custom", manifest, "runtime", "unknown"), packageVersion: null },
        ]);

        expect(mergeCapabilityReportAdapters([runtimeAdapter], report)[0]).toMatchObject({
            capabilityStatus: "unknown",
            capabilityPackageVersion: null,
            capabilities: manifest,
        });
    });
});

function reportAdapter(
    name: string,
    capabilityManifest: AdapterCapabilityManifest | null,
    source: "catalog" | "runtime" = "catalog",
    status: "verified" | "unknown" | "unavailable" = "verified",
) {
    return {
        source,
        status,
        name,
        displayName: `${name} catalog`,
        description: "catalog",
        packageName: `@onebots/adapter-${name}`,
        packageVersion: capabilityManifest ? "1.2.3" : null,
        declared: capabilityManifest !== null,
        capabilities: capabilityManifest,
    };
}

function capabilityReport(adapters: ReturnType<typeof reportAdapter>[]): AdapterCapabilityReport {
    return {
        schemaVersion: 1,
        generatedAt: "2026-09-01T00:00:00.000Z",
        application: { name: "onebots", version: "1.2.8", instanceId: "instance-a" },
        complete: adapters.every(adapter => adapter.status === "verified"),
        errors: adapters.some(adapter => adapter.status === "unavailable")
            ? ["extension-catalog: invalid"]
            : [],
        adapters,
    };
}
