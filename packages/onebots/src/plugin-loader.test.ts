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
        const directory = createImportOnlyPlugin("factory-only-adapter");
        AdapterRegistry.register("factory-only", (() => undefined) as never);

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

function createImportOnlyPlugin(packageName: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-plugin-loader-"));
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
    const packageDirectory = path.join(directory, "node_modules", packageName);
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({ name: packageName, type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(path.join(packageDirectory, "index.js"), "export const loaded = true;\n");
    return directory;
}
