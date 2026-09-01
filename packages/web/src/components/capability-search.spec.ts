import { describe, expect, it } from "vitest";
import type { AdapterCapabilityManifest } from "@onebots/core";
import type { ExtensionInfo } from "../types.js";
import { getCapabilitySearchMatches, matchesExtensionSearch } from "./capability-search.js";

const manifest: AdapterCapabilityManifest = {
    version: 1,
    actions: {
        send_group_file: {
            support: "native",
            availability: "permission",
            scenes: ["group"],
            permissions: ["files:write"],
            note: "发送群文件",
        },
        send_private_file: {
            support: "unsupported",
            scenes: ["private"],
            note: "平台不提供私聊文件",
        },
    },
    events: {
        message_created: { support: "emulated", scenes: ["group"], note: "群消息事件" },
    },
    segments: {},
    transports: {
        webhook: { support: "native", mode: "webhook" },
    },
};

describe("capability search", () => {
    it("matches multiple terms against one supported manifest entry", () => {
        expect(getCapabilitySearchMatches(manifest, "group file")).toEqual([
            expect.objectContaining({ category: "actions", name: "send_group_file" }),
        ]);
        expect(getCapabilitySearchMatches(manifest, "permission files:write")).toEqual([
            expect.objectContaining({ name: "send_group_file" }),
        ]);
        expect(getCapabilitySearchMatches(manifest, "群聊 file")).toEqual([
            expect.objectContaining({ name: "send_group_file" }),
        ]);
    });

    it("does not advertise an explicitly unsupported capability", () => {
        expect(getCapabilitySearchMatches(manifest, "private file")).toEqual([]);
        expect(matchesExtensionSearch(extension("slack", manifest), "private file")).toBe(false);
    });

    it("matches platform metadata or a supported capability without requiring an account", () => {
        expect(matchesExtensionSearch(extension("slack", manifest), "Slack enterprise")).toBe(true);
        expect(matchesExtensionSearch(extension("slack", manifest), "群消息")).toBe(true);
        expect(matchesExtensionSearch(extension("slack", manifest), "polling")).toBe(false);
        expect(matchesExtensionSearch(extension("slack", manifest), "   ")).toBe(true);
    });
});

function extension(name: string, capabilities: AdapterCapabilityManifest): ExtensionInfo {
    return {
        id: `adapter:${name}`,
        type: "adapter",
        name,
        displayName: "Slack Enterprise",
        description: "企业协作平台",
        packageName: `@onebots/adapter-${name}`,
        configurationTarget: { kind: "account", platform: name },
        configurationError: null,
        catalogError: null,
        targetVersion: "1.0.0",
        installedVersion: null,
        versionAligned: false,
        setup: [],
        installed: false,
        enabled: false,
        loaded: false,
        installing: false,
        capability: {
            source: "catalog",
            status: "verified",
            packageVersion: "1.0.0",
            declared: true,
            summary: null,
            manifest: capabilities,
        },
    };
}
