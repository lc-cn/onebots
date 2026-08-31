import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import { loadPlugin, tryLoadPlugin, tryLoadRegisteredPlugin } from "./plugin-loader.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    AdapterRegistry.clear();
    ProtocolRegistry.clear();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("plugin loader", () => {
    it("reports one actionable error when a workspace package exists without its build output", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-plugin-loader-"));
        temporaryDirectories.push(directory);
        fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
        const packageDirectory = path.join(directory, "node_modules", "@onebots", "adapter-kook");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({
                name: "@onebots/adapter-kook",
                main: "lib/index.js",
            }),
        );
        const warnings: string[] = [];

        const loaded = await loadPlugin(
            "adapter",
            "kook",
            ["@onebots/adapter-kook", "onebots-adapter-kook", "kook"],
            createRequire(path.join(directory, "package.json")),
            message => warnings.push(message),
        );

        expect(loaded).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("已找到 @onebots/adapter-kook，但入口无法加载");
        expect(warnings[0]).toContain("pnpm --filter @onebots/adapter-kook build");
        expect(warnings[0]).not.toContain("onebots-adapter-kook 失败");
    });

    it("preserves the plugin initialization error for doctor diagnostics", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-plugin-loader-"));
        temporaryDirectories.push(directory);
        fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
        const packageDirectory = path.join(directory, "node_modules", "conflicting-adapter");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({ name: "conflicting-adapter", main: "index.cjs" }),
        );
        fs.writeFileSync(
            path.join(packageDirectory, "index.cjs"),
            'throw new Error("适配器 mock 已由其他实现注册");',
        );

        const result = await tryLoadPlugin(
            "适配器",
            "mock",
            ["conflicting-adapter"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({
            loaded: false,
            message: expect.stringContaining("适配器 mock 已由其他实现注册"),
        });
    });

    it("rolls back every registration made before plugin initialization fails", async () => {
        const directory = createImportOnlyPlugin(
            "partial-adapter",
            "globalThis.__onebotsRegisterPartial(); throw new Error('partial failure');\n",
        );
        const existingFactory = (() => undefined) as never;
        AdapterRegistry.register("existing", existingFactory, { displayName: "Existing" });
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterPartial?: () => void;
        };
        globals.__onebotsRegisterPartial = () => {
            AdapterRegistry.register("partial", (() => undefined) as never);
            AdapterRegistry.registerSchema("partial", {});
            ProtocolRegistry.register("partial", "v1", (() => undefined) as never);
            ProtocolRegistry.registerSchema("partial.v1", {});
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "partial",
                ["partial-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({
                loaded: false,
                message: expect.stringContaining("partial failure"),
            });
            expect(AdapterRegistry.get("existing")).toBe(existingFactory);
            expect(AdapterRegistry.getMetadata("existing")?.displayName).toBe("Existing");
            expect(AdapterRegistry.has("partial")).toBe(false);
            expect(AdapterRegistry.getSchema("partial")).toBeUndefined();
            expect(ProtocolRegistry.has("partial")).toBe(false);
            expect(ProtocolRegistry.getSchema("partial.v1")).toBeUndefined();
        } finally {
            delete globals.__onebotsRegisterPartial;
        }
    });

    it("rolls back earlier registrations when capability validation rejects a plugin", async () => {
        const directory = createImportOnlyPlugin(
            "malformed-capability-adapter",
            "globalThis.__onebotsRegisterMalformedCapabilities();\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterMalformedCapabilities?: () => void;
        };
        globals.__onebotsRegisterMalformedCapabilities = () => {
            AdapterRegistry.register("leaked", (() => undefined) as never);
            AdapterRegistry.register("malformed", (() => undefined) as never, {
                capabilities: {
                    version: 1,
                    actions: {},
                    events: {},
                    segments: { text: { support: "native" } },
                    transports: {},
                } as never,
            });
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "malformed",
                ["malformed-capability-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({
                loaded: false,
                message: expect.stringContaining("direction 无效"),
            });
            expect(AdapterRegistry.has("leaked")).toBe(false);
            expect(AdapterRegistry.has("malformed")).toBe(false);
        } finally {
            delete globals.__onebotsRegisterMalformedCapabilities;
        }
    });

    it("loads a pure ESM plugin that uses top-level await", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-plugin-loader-"));
        temporaryDirectories.push(directory);
        fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
        const packageDirectory = path.join(directory, "node_modules", "async-adapter");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({
                name: "async-adapter",
                type: "module",
                exports: { ".": { import: "./index.js" } },
            }),
        );
        fs.writeFileSync(
            path.join(packageDirectory, "index.js"),
            "await Promise.resolve(); export const initialized = true;",
        );

        const result = await tryLoadPlugin(
            "适配器",
            "async",
            ["async-adapter"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({ loaded: true });
    });

    it("selects the import condition instead of a conflicting require entry", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-plugin-loader-"));
        temporaryDirectories.push(directory);
        fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
        const packageDirectory = path.join(directory, "node_modules", "conditional-adapter");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({
                name: "conditional-adapter",
                type: "module",
                exports: {
                    ".": { import: "./index.js", require: "./index.cjs" },
                },
            }),
        );
        fs.writeFileSync(path.join(packageDirectory, "index.js"), "export const loaded = true;");
        fs.writeFileSync(
            path.join(packageDirectory, "index.cjs"),
            'throw new Error("require branch must not execute");',
        );

        const result = await tryLoadPlugin(
            "适配器",
            "conditional",
            ["conditional-adapter"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({
            loaded: true,
            inspection: { entryPath: path.join(packageDirectory, "index.js") },
        });
    });

    it("rejects an importable adapter that does not register its promised factory", async () => {
        const directory = createImportOnlyPlugin("empty-adapter");

        const result = await tryLoadRegisteredPlugin(
            "adapter",
            "empty",
            ["empty-adapter"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({
            loaded: false,
            message: expect.stringContaining("已初始化，但没有注册适配器 empty"),
        });
    });

    it("rejects an adapter factory without its configuration schema", async () => {
        const directory = createImportOnlyPlugin(
            "factory-only-adapter",
            "globalThis.__onebotsRegisterFactoryOnly();\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterFactoryOnly?: () => void;
        };
        globals.__onebotsRegisterFactoryOnly = () => {
            AdapterRegistry.register("factory-only", (() => undefined) as never);
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "factory-only",
                ["factory-only-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({
                loaded: false,
                message: expect.stringContaining("没有注册适配器配置 Schema factory-only"),
            });
            expect(AdapterRegistry.has("factory-only")).toBe(false);
        } finally {
            delete globals.__onebotsRegisterFactoryOnly;
        }
    });

    it("serializes plugin transactions so a failed rollback cannot erase a concurrent success", async () => {
        const brokenDirectory = createImportOnlyPlugin(
            "queued-broken-adapter",
            "await globalThis.__onebotsHoldBroken();\n",
        );
        const successfulDirectory = createImportOnlyPlugin(
            "queued-success-adapter",
            "globalThis.__onebotsRegisterQueuedSuccess();\n",
        );
        let releaseBroken: () => void = () => undefined;
        let markBrokenEntered: () => void = () => undefined;
        const brokenEntered = new Promise<void>(resolve => {
            markBrokenEntered = resolve;
        });
        const brokenGate = new Promise<void>(resolve => {
            releaseBroken = resolve;
        });
        let successfulPluginExecuted = false;
        const globals = globalThis as typeof globalThis & {
            __onebotsHoldBroken?: () => Promise<void>;
            __onebotsRegisterQueuedSuccess?: () => void;
        };
        globals.__onebotsHoldBroken = () => {
            AdapterRegistry.register("queued-broken", (() => undefined) as never);
            markBrokenEntered();
            return brokenGate;
        };
        globals.__onebotsRegisterQueuedSuccess = () => {
            successfulPluginExecuted = true;
            AdapterRegistry.register("queued-success", (() => undefined) as never);
            AdapterRegistry.registerSchema("queued-success", {});
        };

        try {
            const broken = tryLoadRegisteredPlugin(
                "adapter",
                "queued-broken",
                ["queued-broken-adapter"],
                createRequire(path.join(brokenDirectory, "package.json")),
            );
            await brokenEntered;
            const successful = tryLoadRegisteredPlugin(
                "adapter",
                "queued-success",
                ["queued-success-adapter"],
                createRequire(path.join(successfulDirectory, "package.json")),
            );

            await Promise.resolve();
            expect(successfulPluginExecuted).toBe(false);
            releaseBroken();
            await expect(broken).resolves.toMatchObject({ loaded: false });
            await expect(successful).resolves.toMatchObject({ loaded: true });
            expect(AdapterRegistry.has("queued-broken")).toBe(false);
            expect(AdapterRegistry.has("queued-success")).toBe(true);
            expect(AdapterRegistry.getSchema("queued-success")).toBeDefined();
        } finally {
            delete globals.__onebotsHoldBroken;
            delete globals.__onebotsRegisterQueuedSuccess;
        }
    });

    it("accepts a protocol only when its name-version factory and schema are registered", async () => {
        const directory = createImportOnlyPlugin("complete-protocol");
        ProtocolRegistry.register("complete", "v1", (() => undefined) as never);
        ProtocolRegistry.registerSchema("complete.v1", {});

        const result = await tryLoadRegisteredPlugin(
            "protocol",
            "complete-v1",
            ["complete-protocol"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({ loaded: true });
    });
});

function createImportOnlyPlugin(
    packageName: string,
    source = "export const loaded = true;\n",
): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-plugin-loader-"));
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
    const packageDirectory = path.join(directory, "node_modules", packageName);
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({ name: packageName, type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(path.join(packageDirectory, "index.js"), source);
    return directory;
}
