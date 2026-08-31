import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AdapterRegistry, EMPTY_ADAPTER_CAPABILITIES, type Adapter } from "@onebots/core";
import { showCapabilities } from "./command-application.js";
import type { LoadedPluginInfo } from "../plugin-loader.js";

const directories: string[] = [];

afterEach(() => {
    AdapterRegistry.clear();
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("capabilities command", () => {
    it("exports the complete catalog without installing an adapter or creating an account", async () => {
        const calls: Array<{ adapters: string[]; protocols: string[] }> = [];

        const result = await showCapabilities(
            { register: [], protocol: [], json: true },
            {
                loadPlugins: async (adapters, protocols) => {
                    calls.push({ adapters, protocols });
                    return [];
                },
                getLoadedPlugins: () => [],
            },
        );
        const report = JSON.parse(result.output || "{}") as {
            complete: boolean;
            adapters: Array<{
                source: string;
                name: string;
                entryPath: string | null;
                capabilities: unknown;
            }>;
        };

        expect(calls).toEqual([{ adapters: [], protocols: [] }]);
        expect(result).toMatchObject({ raw: true, exitCode: undefined });
        expect(report.complete).toBe(true);
        expect(report.adapters.length).toBeGreaterThan(0);
        expect(report.adapters.find(adapter => adapter.name === "slack")).toMatchObject({
            source: "catalog",
            entryPath: null,
            capabilities: expect.any(Object),
        });
    });

    it("reuses persisted adapter defaults and emits raw JSON without loading protocols", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-capabilities-"));
        directories.push(directory);
        const config = path.join(directory, "config.yaml");
        fs.writeFileSync(
            config,
            "plugins:\n  adapters: [mock]\n  protocols: [onebot-v11]\n",
            "utf8",
        );
        AdapterRegistry.register("mock", (() => undefined) as unknown as Adapter.Factory, {
            displayName: "Mock",
            capabilities: EMPTY_ADAPTER_CAPABILITIES,
        });
        const loaded: LoadedPluginInfo = {
            type: "adapter",
            name: "mock",
            packageName: "@onebots/adapter-mock",
            version: "1.0.17",
            entryPath: "/runtime/mock.js",
        };
        const calls: Array<{ adapters: string[]; protocols: string[] }> = [];

        const result = await showCapabilities(
            { config, register: [], protocol: [], json: true },
            {
                loadPlugins: async (adapters, protocols) => {
                    calls.push({ adapters, protocols });
                    return [];
                },
                getLoadedPlugins: () => [loaded],
            },
        );

        expect(calls).toEqual([{ adapters: ["mock"], protocols: [] }]);
        expect(result).toMatchObject({ raw: true, exitCode: undefined });
        expect(JSON.parse(result.output || "{}")).toMatchObject({
            complete: true,
            errors: [],
            adapters: [{ name: "mock", packageName: "@onebots/adapter-mock" }],
        });
    });

    it("returns a preflight exit code when an adapter has no declared manifest", async () => {
        AdapterRegistry.register("third-party", (() => undefined) as unknown as Adapter.Factory);

        const result = await showCapabilities(
            { register: ["third-party"], protocol: [], json: false },
            {
                loadPlugins: async () => [],
                getLoadedPlugins: () => [
                    {
                        type: "adapter",
                        name: "third-party",
                        packageName: "third-party",
                        version: null,
                        entryPath: "/runtime/third-party.js",
                    },
                ],
            },
        );

        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("未声明默认能力清单");
    });

    it("preserves adapter load failures as machine-readable JSON", async () => {
        const result = await showCapabilities(
            { register: ["missing"], protocol: [], json: true },
            {
                loadPlugins: async () => ["adapter:missing"],
                getLoadedPlugins: () => [],
            },
        );

        expect(result).toMatchObject({ raw: true, exitCode: 2 });
        expect(JSON.parse(result.output || "{}")).toEqual({
            complete: false,
            errors: ["adapter:missing"],
            adapters: [],
        });
    });

    it("keeps a built-in catalog snapshot visible when its runtime plugin fails to load", async () => {
        const result = await showCapabilities(
            { register: ["slack"], protocol: [], json: true },
            {
                loadPlugins: async () => ["adapter:slack: 构建产物不存在"],
                getLoadedPlugins: () => [],
            },
        );

        expect(result).toMatchObject({ raw: true, exitCode: 2 });
        expect(JSON.parse(result.output || "{}")).toMatchObject({
            complete: false,
            errors: ["adapter:slack: 构建产物不存在"],
            adapters: [
                {
                    name: "slack",
                    source: "catalog",
                    entryPath: null,
                    declared: true,
                },
            ],
        });
    });

    it("fails closed when the packaged capability catalog is incomplete", async () => {
        const result = await showCapabilities(
            { register: [], protocol: [], json: true },
            {
                loadPlugins: async () => [],
                getLoadedPlugins: () => [],
                catalogPlatforms: () => ["slack"],
                catalogIssues: () => ["适配器能力快照缺失: telegram"],
            },
        );

        expect(result).toMatchObject({ raw: true, exitCode: 1 });
        expect(JSON.parse(result.output || "{}")).toMatchObject({
            complete: false,
            errors: ["extension-catalog: 适配器能力快照缺失: telegram"],
            adapters: [{ name: "slack", source: "catalog" }],
        });
    });
});
