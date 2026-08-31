import { describe, expect, it } from "vitest";
import type { AdapterCapabilityManifest } from "@onebots/core";
import { countSupportedCapabilities, getCapabilityEntries } from "./capability-presentation.js";

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
});
