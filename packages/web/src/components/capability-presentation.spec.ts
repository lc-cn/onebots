import { describe, expect, it } from "vitest";
import type { AdapterCapabilityManifest } from "@onebots/core";
import {
    countSupportedCapabilities,
    getCapabilityEntries,
    hasAccountCapabilityOverride,
    mergeCapabilityAdapters,
    resolveAccountCapabilityError,
    resolveAccountCapabilities,
} from "./capability-presentation.js";
import type { AdapterInfo, ExtensionInfo } from "../types";

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
        const extensions = [
            extension("telegram", manifest),
            extension("discord", manifest),
            extension("undeclared", null),
            { ...extension("protocol", manifest), type: "protocol" as const },
        ];

        const result = mergeCapabilityAdapters([runtimeAdapter], extensions);

        expect(result.map(adapter => adapter.platform)).toEqual(["telegram", "discord"]);
        expect(result[0]).toMatchObject({
            displayName: "Telegram runtime",
            capabilitySource: "runtime",
            capabilityPackageVersion: "1.2.3",
        });
        expect(result[1]).toMatchObject({
            displayName: "discord catalog",
            capabilitySource: "catalog",
            capabilityPackageVersion: "1.2.3",
            accounts: [],
            capabilities: manifest,
        });
    });
});

function extension(
    name: string,
    capabilityManifest: AdapterCapabilityManifest | null,
): ExtensionInfo {
    return {
        id: `adapter:${name}`,
        type: "adapter",
        name,
        displayName: `${name} catalog`,
        description: "catalog",
        packageName: `@onebots/adapter-${name}`,
        configurationTarget: { kind: "account", platform: name },
        configurationError: null,
        targetVersion: "1.2.3",
        installedVersion: null,
        versionAligned: false,
        setup: [],
        installed: false,
        enabled: false,
        loaded: false,
        installing: false,
        capability: capabilityManifest
            ? {
                  source: "catalog",
                  packageVersion: "1.2.3",
                  declared: true,
                  summary: null,
                  manifest: capabilityManifest,
              }
            : {
                  source: "catalog",
                  packageVersion: null,
                  declared: false,
                  summary: null,
                  manifest: null,
              },
    };
}
