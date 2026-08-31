import { describe, expect, it } from "vitest";
import type { Schema } from "@onebots/core";
import {
    createBaseSetupConfig,
    createProtocolDefaults,
    formatConfiguredCommand,
    normalizePluginNames,
} from "./setup-config.js";

const satoriSchema: Schema = {
    use_http: {
        type: "boolean",
        default: true,
        label: "启用 HTTP",
        ui: { section: "transport" },
    },
    webhooks: {
        type: "array",
        default: [],
        label: "Webhook",
        ui: { section: "delivery" },
    },
};

describe("setup configuration", () => {
    it("starts without a reference to an unloaded protocol", () => {
        expect(createBaseSetupConfig()).toEqual({
            port: 6727,
            log_level: "info",
            timeout: 30,
            general: {},
        });
    });

    it("derives defaults only from the loaded protocol schemas", () => {
        expect(createProtocolDefaults({ "satori.v1": satoriSchema })).toEqual({
            "satori.v1": { use_http: true, webhooks: [] },
        });
    });

    it("deduplicates plugin names and emits shell-safe next-step commands", () => {
        expect(normalizePluginNames([" mock ", "mock", "", "one bot"])).toEqual([
            "mock",
            "one bot",
        ]);
        expect(formatConfiguredCommand("/tmp/one bots/config.yaml", "capabilities")).toBe(
            "onebots capabilities -c '/tmp/one bots/config.yaml'",
        );
        expect(formatConfiguredCommand("/tmp/one bots/config.yaml", "doctor")).toBe(
            "onebots doctor -c '/tmp/one bots/config.yaml'",
        );
    });
});
