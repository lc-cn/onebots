import { describe, expect, it } from "vitest";
import type { AdapterCapabilityManifest } from "@onebots/core";
import {
    countSupportedCapabilities,
    getCapabilityEntries,
    hasAccountCapabilityOverride,
    resolveAccountCapabilities,
} from "./capability-presentation.js";

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
});
