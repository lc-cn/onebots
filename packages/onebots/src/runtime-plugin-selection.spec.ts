import { describe, expect, it } from "vitest";
import {
    getRuntimePluginSelection,
    setRuntimePluginSelection,
} from "./runtime-plugin-selection.js";

describe("runtime plugin selection", () => {
    it("keeps legacy configs distinguishable and normalizes an explicit selection", () => {
        expect(getRuntimePluginSelection({ general: {} })).toBeUndefined();
        expect(
            getRuntimePluginSelection({
                plugins: {
                    adapters: [" mock ", "mock", "qq"],
                    protocols: ["onebot-v11"],
                },
            }),
        ).toEqual({ adapters: ["mock", "qq"], protocols: ["onebot-v11"] });
    });

    it("rejects malformed lists and unknown fields at the configuration boundary", () => {
        expect(() => getRuntimePluginSelection({ plugins: [] })).toThrow("plugins 必须是对象");
        expect(() =>
            getRuntimePluginSelection({ plugins: { adapters: [""], protocols: [] } }),
        ).toThrow("plugins.adapters.0 必须是非空字符串");
        expect(() =>
            getRuntimePluginSelection({ plugins: { adapters: [], enabled: true } }),
        ).toThrow("plugins 包含未知字段 enabled");
    });

    it("writes a detached normalized selection", () => {
        const config: Record<string, unknown> = {};
        const selection = { adapters: [" mock "], protocols: ["satori-v1"] };

        setRuntimePluginSelection(config, selection);
        selection.adapters.push("qq");

        expect(config.plugins).toEqual({
            adapters: ["mock"],
            protocols: ["satori-v1"],
        });
    });
});
