import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import {
    clearLoadedPlugins,
    getLoadedPlugins,
    loadPlugin,
    tryLoadPlugin,
    tryLoadRegisteredPlugin,
} from "./plugin-loader.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    AdapterRegistry.clear();
    ProtocolRegistry.clear();
    clearLoadedPlugins();
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

    it("rejects a package directory whose manifest claims another package identity", async () => {
        const directory = createImportOnlyPlugin(
            "declared-adapter",
            "globalThis.__onebotsMismatchedPackageExecuted = true;\n",
        );
        const packageDirectory = path.join(directory, "node_modules", "declared-adapter");
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({
                name: "substituted-adapter",
                version: "1.0.0",
                type: "module",
                exports: "./index.js",
            }),
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsMismatchedPackageExecuted?: boolean;
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "declared",
                ["declared-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({
                loaded: false,
                message: expect.stringContaining(
                    "package.json 包名错配，期望 declared-adapter，实际 substituted-adapter",
                ),
            });
            expect(globals.__onebotsMismatchedPackageExecuted).toBeUndefined();
            expect(getLoadedPlugins()).toEqual([]);
        } finally {
            delete globals.__onebotsMismatchedPackageExecuted;
        }
    });

    it.skipIf(process.platform === "win32")(
        "在执行代码前拒绝通过包内软链接逃逸的插件入口",
        async () => {
            const directory = createImportOnlyPlugin("linked-entry-adapter");
            const packageDirectory = path.join(directory, "node_modules", "linked-entry-adapter");
            const externalEntry = path.join(directory, "external-entry.js");
            fs.writeFileSync(externalEntry, "globalThis.__onebotsExternalEntryExecuted = true;\n");
            fs.rmSync(path.join(packageDirectory, "index.js"));
            fs.symlinkSync(externalEntry, path.join(packageDirectory, "index.js"));
            const globals = globalThis as typeof globalThis & {
                __onebotsExternalEntryExecuted?: boolean;
            };

            try {
                const result = await tryLoadRegisteredPlugin(
                    "adapter",
                    "linked-entry",
                    ["linked-entry-adapter"],
                    createRequire(path.join(directory, "package.json")),
                );

                expect(result).toMatchObject({
                    loaded: false,
                    message: expect.stringContaining("插件入口解析到实际包目录外"),
                });
                expect(globals.__onebotsExternalEntryExecuted).toBeUndefined();
                expect(getLoadedPlugins()).toEqual([]);
            } finally {
                delete globals.__onebotsExternalEntryExecuted;
            }
        },
    );

    it.skipIf(process.platform === "win32")(
        "允许整个插件包目录由 workspace 或包管理器软链接提供",
        async () => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-plugin-loader-"));
            temporaryDirectories.push(directory);
            fs.writeFileSync(
                path.join(directory, "package.json"),
                JSON.stringify({ type: "module" }),
            );
            const sourceDirectory = path.join(directory, "workspace-adapter");
            fs.mkdirSync(sourceDirectory, { recursive: true });
            fs.writeFileSync(
                path.join(sourceDirectory, "package.json"),
                JSON.stringify({
                    name: "workspace-linked-adapter",
                    type: "module",
                    exports: "./index.js",
                }),
            );
            fs.writeFileSync(
                path.join(sourceDirectory, "index.js"),
                "export const loaded = true;\n",
            );
            const nodeModules = path.join(directory, "node_modules");
            fs.mkdirSync(nodeModules);
            fs.symlinkSync(sourceDirectory, path.join(nodeModules, "workspace-linked-adapter"));

            const result = await tryLoadPlugin(
                "适配器",
                "workspace-linked",
                ["workspace-linked-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({ loaded: true });
        },
    );

    it("在解析前拒绝超过上限的插件清单", async () => {
        const directory = createImportOnlyPlugin(
            "oversized-manifest-adapter",
            "globalThis.__onebotsOversizedManifestExecuted = true;\n",
        );
        const manifestPath = path.join(
            directory,
            "node_modules",
            "oversized-manifest-adapter",
            "package.json",
        );
        fs.writeFileSync(manifestPath, Buffer.alloc(1024 * 1024 + 1, 0x20));
        const globals = globalThis as typeof globalThis & {
            __onebotsOversizedManifestExecuted?: boolean;
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "oversized-manifest",
                ["oversized-manifest-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({
                loaded: false,
                message: expect.stringContaining("package.json 超过 1048576 字节上限"),
            });
            expect(globals.__onebotsOversizedManifestExecuted).toBeUndefined();
        } finally {
            delete globals.__onebotsOversizedManifestExecuted;
        }
    });

    it.skipIf(process.platform === "win32")("在读取前拒绝不是常规文件的插件清单", async () => {
        const directory = createImportOnlyPlugin("directory-manifest-adapter");
        const manifestPath = path.join(
            directory,
            "node_modules",
            "directory-manifest-adapter",
            "package.json",
        );
        fs.rmSync(manifestPath);
        fs.mkdirSync(manifestPath);

        const result = await tryLoadRegisteredPlugin(
            "adapter",
            "directory-manifest",
            ["directory-manifest-adapter"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({
            loaded: false,
            message: expect.stringContaining("package.json 不是常规文件"),
        });
        expect(getLoadedPlugins()).toEqual([]);
    });

    it("拒绝把目录误判为可加载的插件入口", async () => {
        const directory = createImportOnlyPlugin("directory-entry-adapter");
        const entryPath = path.join(
            directory,
            "node_modules",
            "directory-entry-adapter",
            "index.js",
        );
        fs.rmSync(entryPath);
        fs.mkdirSync(entryPath);

        const result = await tryLoadRegisteredPlugin(
            "adapter",
            "directory-entry",
            ["directory-entry-adapter"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({
            loaded: false,
            message: expect.stringContaining("插件入口不是常规文件"),
        });
        expect(getLoadedPlugins()).toEqual([]);
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

    it("rejects registry mutations scheduled after a successful plugin transaction", async () => {
        const directory = createImportOnlyPlugin(
            "late-adapter",
            `globalThis.__onebotsRegisterOnTime();
setTimeout(() => {
    try {
        globalThis.__onebotsRegisterLate();
    } catch (error) {
        globalThis.__onebotsLateRegistrationError = error instanceof Error ? error.message : String(error);
    }
}, 0);
`,
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterOnTime?: () => void;
            __onebotsRegisterLate?: () => void;
            __onebotsLateRegistrationError?: string;
        };
        globals.__onebotsRegisterOnTime = () => {
            AdapterRegistry.register("late", (() => undefined) as never);
            AdapterRegistry.registerSchema("late", {});
        };
        globals.__onebotsRegisterLate = () => {
            AdapterRegistry.register("hidden", (() => undefined) as never);
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "late",
                ["late-adapter"],
                createRequire(path.join(directory, "package.json")),
            );
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(result).toMatchObject({ loaded: true });
            expect(AdapterRegistry.has("late")).toBe(true);
            expect(AdapterRegistry.has("hidden")).toBe(false);
            expect(globals.__onebotsLateRegistrationError).toBe(
                "插件注册事务已结束，拒绝迟到的注册表修改",
            );
        } finally {
            delete globals.__onebotsRegisterOnTime;
            delete globals.__onebotsRegisterLate;
            delete globals.__onebotsLateRegistrationError;
        }
    });

    it("keeps a failed plugin closed to delayed registry mutations after rollback", async () => {
        const directory = createImportOnlyPlugin(
            "failed-late-adapter",
            `setTimeout(() => {
    try {
        globalThis.__onebotsRegisterAfterFailure();
    } catch (error) {
        globalThis.__onebotsFailedLateRegistrationError = error instanceof Error ? error.message : String(error);
    }
}, 0);
throw new Error("初始化失败");
`,
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterAfterFailure?: () => void;
            __onebotsFailedLateRegistrationError?: string;
        };
        globals.__onebotsRegisterAfterFailure = () => {
            ProtocolRegistry.register("hidden", "v1", (() => undefined) as never);
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "failed-late",
                ["failed-late-adapter"],
                createRequire(path.join(directory, "package.json")),
            );
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(result).toMatchObject({ loaded: false });
            expect(ProtocolRegistry.has("hidden", "v1")).toBe(false);
            expect(globals.__onebotsFailedLateRegistrationError).toBe(
                "插件注册事务已结束，拒绝迟到的注册表修改",
            );
        } finally {
            delete globals.__onebotsRegisterAfterFailure;
            delete globals.__onebotsFailedLateRegistrationError;
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

    it.each(["onebots", "@onebots/core"] as const)(
        "rejects a second %s runtime before the plugin module can initialize",
        async packageName => {
            const pluginName =
                packageName === "onebots" ? "isolated-onebots-adapter" : "isolated-core-adapter";
            const directory = createImportOnlyPlugin(
                pluginName,
                "globalThis.__onebotsIsolatedPluginExecuted = true;\n",
            );
            const nestedRuntime = path.join(
                directory,
                "node_modules",
                pluginName,
                "node_modules",
                ...packageName.split("/"),
            );
            fs.mkdirSync(nestedRuntime, { recursive: true });
            fs.writeFileSync(
                path.join(nestedRuntime, "package.json"),
                JSON.stringify({ name: packageName, type: "module", main: "index.js" }),
            );
            fs.writeFileSync(path.join(nestedRuntime, "index.js"), "export {};\n");
            const globals = globalThis as typeof globalThis & {
                __onebotsIsolatedPluginExecuted?: boolean;
            };

            try {
                const result = await tryLoadPlugin(
                    "适配器",
                    "isolated",
                    [pluginName],
                    createRequire(path.join(directory, "package.json")),
                );

                expect(result).toMatchObject({
                    loaded: false,
                    message: expect.stringContaining(`解析到了独立的 ${packageName} 运行时`),
                });
                expect(result.loaded === false ? result.message : "").toContain(
                    `请将 ${packageName} 声明为 peerDependency`,
                );
                expect(globals.__onebotsIsolatedPluginExecuted).toBeUndefined();
                expect(getLoadedPlugins()).toEqual([]);
            } finally {
                delete globals.__onebotsIsolatedPluginExecuted;
            }
        },
    );

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

    it("re-executes an ESM entry after a rejected registration contract", async () => {
        const directory = createImportOnlyPlugin(
            "retryable-adapter",
            "globalThis.__onebotsRegisterRetryableAdapter();\n",
        );
        let registrations = 0;
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterRetryableAdapter?: () => void;
        };
        globals.__onebotsRegisterRetryableAdapter = () => {
            registrations += 1;
            AdapterRegistry.register("retryable", (() => undefined) as never);
            if (registrations > 1) AdapterRegistry.registerSchema("retryable", {});
        };
        const runtimeRequire = createRequire(path.join(directory, "package.json"));

        try {
            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "retryable",
                    ["retryable-adapter"],
                    runtimeRequire,
                ),
            ).resolves.toMatchObject({
                loaded: false,
                message: expect.stringContaining("没有注册适配器配置 Schema retryable"),
            });
            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "retryable",
                    ["retryable-adapter"],
                    runtimeRequire,
                ),
            ).resolves.toMatchObject({ loaded: true });
            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "retryable",
                    ["retryable-adapter"],
                    runtimeRequire,
                ),
            ).resolves.toMatchObject({ loaded: true });

            expect(registrations).toBe(2);
            expect(AdapterRegistry.has("retryable")).toBe(true);
            expect(AdapterRegistry.getSchema("retryable")).toBeDefined();
            expect(getLoadedPlugins()).toMatchObject([
                {
                    name: "retryable",
                    moduleUrl: expect.stringContaining("onebots_retry=1"),
                },
            ]);
        } finally {
            delete globals.__onebotsRegisterRetryableAdapter;
        }
    });

    it("rolls back an adapter plugin that registers identities outside its CLI promise", async () => {
        const directory = createImportOnlyPlugin(
            "overreaching-adapter",
            "globalThis.__onebotsRegisterOverreachingAdapter();\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterOverreachingAdapter?: () => void;
        };
        globals.__onebotsRegisterOverreachingAdapter = () => {
            AdapterRegistry.register("overreaching", (() => undefined) as never);
            AdapterRegistry.registerSchema("overreaching", {});
            AdapterRegistry.register("hidden", (() => undefined) as never);
            ProtocolRegistry.register("hidden", "v1", (() => undefined) as never);
            ProtocolRegistry.registerSchema("hidden.v1", {});
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "overreaching",
                ["overreaching-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({ loaded: false });
            const message = result.loaded === false ? result.message : "";
            expect(message).toContain("CLI 名称未承诺的注册项");
            expect(message).toContain("适配器工厂 hidden");
            expect(message).toContain("协议工厂 hidden/v1");
            expect(AdapterRegistry.has("overreaching")).toBe(false);
            expect(AdapterRegistry.has("hidden")).toBe(false);
            expect(ProtocolRegistry.has("hidden", "v1")).toBe(false);
            expect(getLoadedPlugins()).toEqual([]);
        } finally {
            delete globals.__onebotsRegisterOverreachingAdapter;
        }
    });

    it("does not attribute a pre-existing registry identity to an unrelated package", async () => {
        const directory = createImportOnlyPlugin("identity-claim-adapter");
        const existingFactory = (() => undefined) as never;
        AdapterRegistry.register("identity-claim", existingFactory);
        AdapterRegistry.registerSchema("identity-claim", {});

        const result = await tryLoadRegisteredPlugin(
            "adapter",
            "identity-claim",
            ["identity-claim-adapter"],
            createRequire(path.join(directory, "package.json")),
        );

        expect(result).toMatchObject({
            loaded: false,
            message: expect.stringContaining("在本次插件加载前已经存在，无法证明注册归属"),
        });
        expect(AdapterRegistry.get("identity-claim")).toBe(existingFactory);
        expect(getLoadedPlugins()).toEqual([]);
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

    it("accepts a protocol only when its own entry registers the promised factory and schema", async () => {
        const directory = createImportOnlyPlugin(
            "complete-protocol",
            "globalThis.__onebotsRegisterCompleteProtocol();\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterCompleteProtocol?: () => void;
        };
        globals.__onebotsRegisterCompleteProtocol = () => {
            ProtocolRegistry.register("complete", "v1", (() => undefined) as never);
            ProtocolRegistry.registerSchema("complete.v1", {});
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "protocol",
                "complete-v1",
                ["complete-protocol"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({ loaded: true });
        } finally {
            delete globals.__onebotsRegisterCompleteProtocol;
        }
    });

    it("allows another promised version to update shared protocol metadata", async () => {
        ProtocolRegistry.register("multi", "v1", (() => undefined) as never);
        ProtocolRegistry.registerSchema("multi.v1", {});
        const directory = createImportOnlyPlugin(
            "multi-v2-protocol",
            "globalThis.__onebotsRegisterMultiV2Protocol();\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterMultiV2Protocol?: () => void;
        };
        globals.__onebotsRegisterMultiV2Protocol = () => {
            ProtocolRegistry.register("multi", "v2", (() => undefined) as never);
            ProtocolRegistry.registerSchema("multi.v2", {});
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "protocol",
                "multi-v2",
                ["multi-v2-protocol"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({ loaded: true });
            expect(ProtocolRegistry.getVersions("multi")).toEqual(["v1", "v2"]);
        } finally {
            delete globals.__onebotsRegisterMultiV2Protocol;
        }
    });

    it("rolls back a protocol plugin that also registers an adapter", async () => {
        const directory = createImportOnlyPlugin(
            "overreaching-protocol",
            "globalThis.__onebotsRegisterOverreachingProtocol();\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterOverreachingProtocol?: () => void;
        };
        globals.__onebotsRegisterOverreachingProtocol = () => {
            ProtocolRegistry.register("overreaching", "v1", (() => undefined) as never);
            ProtocolRegistry.registerSchema("overreaching.v1", {});
            AdapterRegistry.register("hidden", (() => undefined) as never);
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "protocol",
                "overreaching-v1",
                ["overreaching-protocol"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({
                loaded: false,
                message: expect.stringContaining("适配器工厂 hidden"),
            });
            expect(ProtocolRegistry.has("overreaching", "v1")).toBe(false);
            expect(AdapterRegistry.has("hidden")).toBe(false);
        } finally {
            delete globals.__onebotsRegisterOverreachingProtocol;
        }
    });

    it("在执行入口前拒绝用另一包占用已加载的逻辑身份", async () => {
        const firstDirectory = createImportOnlyPlugin(
            "first-identity-adapter",
            "globalThis.__onebotsRegisterLockedIdentity();\n",
        );
        const secondDirectory = createImportOnlyPlugin(
            "second-identity-adapter",
            "globalThis.__onebotsConflictingIdentityExecuted = true;\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterLockedIdentity?: () => void;
            __onebotsConflictingIdentityExecuted?: boolean;
        };
        globals.__onebotsRegisterLockedIdentity = () => {
            AdapterRegistry.register("locked-identity", (() => undefined) as never);
            AdapterRegistry.registerSchema("locked-identity", {});
        };

        try {
            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "locked-identity",
                    ["first-identity-adapter"],
                    createRequire(path.join(firstDirectory, "package.json")),
                ),
            ).resolves.toMatchObject({ loaded: true });

            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "locked-identity",
                    ["second-identity-adapter"],
                    createRequire(path.join(secondDirectory, "package.json")),
                ),
            ).resolves.toMatchObject({
                loaded: false,
                message: expect.stringMatching(
                    /已由 first-identity-adapter@unknown.*当前解析为 second-identity-adapter@unknown.*拒绝在同一进程执行/,
                ),
            });
            expect(globals.__onebotsConflictingIdentityExecuted).toBeUndefined();
            expect(getLoadedPlugins()).toMatchObject([
                { name: "locked-identity", packageName: "first-identity-adapter" },
            ]);
        } finally {
            delete globals.__onebotsRegisterLockedIdentity;
            delete globals.__onebotsConflictingIdentityExecuted;
        }
    });

    it("拒绝把 ESM 缓存中的旧入口重新标记为磁盘上的新版本", async () => {
        const directory = createImportOnlyPlugin(
            "version-locked-adapter",
            "globalThis.__onebotsRegisterVersionLocked();\n",
        );
        const packageJsonPath = path.join(
            directory,
            "node_modules",
            "version-locked-adapter",
            "package.json",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterVersionLocked?: () => void;
        };
        globals.__onebotsRegisterVersionLocked = () => {
            AdapterRegistry.register("version-locked", (() => undefined) as never);
            AdapterRegistry.registerSchema("version-locked", {});
        };
        const writeManifest = (version: string) =>
            fs.writeFileSync(
                packageJsonPath,
                JSON.stringify({
                    name: "version-locked-adapter",
                    version,
                    type: "module",
                    exports: "./index.js",
                }),
            );

        try {
            writeManifest("1.0.0");
            const runtimeRequire = createRequire(path.join(directory, "package.json"));
            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "version-locked",
                    ["version-locked-adapter"],
                    runtimeRequire,
                ),
            ).resolves.toMatchObject({ loaded: true });

            writeManifest("2.0.0");
            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "version-locked",
                    ["version-locked-adapter"],
                    runtimeRequire,
                ),
            ).resolves.toMatchObject({
                loaded: false,
                message: expect.stringMatching(/version-locked-adapter@1\.0\.0.*2\.0\.0/),
            });
            expect(getLoadedPlugins()).toMatchObject([
                { name: "version-locked", version: "1.0.0" },
            ]);
        } finally {
            delete globals.__onebotsRegisterVersionLocked;
        }
    });

    it("records package identity only after the promised registration contract succeeds", async () => {
        const directory = createImportOnlyPlugin(
            "inventory-adapter",
            "globalThis.__onebotsRegisterInventoryAdapter();\n",
        );
        const packageJsonPath = path.join(
            directory,
            "node_modules",
            "inventory-adapter",
            "package.json",
        );
        fs.writeFileSync(
            packageJsonPath,
            JSON.stringify({
                name: "inventory-adapter",
                version: "2.4.6",
                type: "module",
                exports: "./index.js",
            }),
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterInventoryAdapter?: () => void;
        };
        globals.__onebotsRegisterInventoryAdapter = () => {
            AdapterRegistry.register("inventory", (() => undefined) as never);
            AdapterRegistry.registerSchema("inventory", {});
        };

        try {
            const result = await tryLoadRegisteredPlugin(
                "adapter",
                "inventory",
                ["inventory-adapter"],
                createRequire(path.join(directory, "package.json")),
            );

            expect(result).toMatchObject({
                loaded: true,
                inspection: { packageName: "inventory-adapter", version: "2.4.6" },
            });
            await expect(
                tryLoadRegisteredPlugin(
                    "adapter",
                    "inventory",
                    ["inventory-adapter"],
                    createRequire(path.join(directory, "package.json")),
                ),
            ).resolves.toMatchObject({ loaded: true });
            expect(getLoadedPlugins()).toEqual([
                {
                    type: "adapter",
                    name: "inventory",
                    packageName: "inventory-adapter",
                    version: "2.4.6",
                    entryPath: fs.realpathSync(
                        path.join(directory, "node_modules", "inventory-adapter", "index.js"),
                    ),
                    moduleUrl: pathToFileURL(
                        path.join(directory, "node_modules", "inventory-adapter", "index.js"),
                    ).href,
                },
            ]);
        } finally {
            delete globals.__onebotsRegisterInventoryAdapter;
        }
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
