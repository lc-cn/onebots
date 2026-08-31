import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadPlugin, tryLoadPlugin } from "./plugin-loader.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
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
            "适配器",
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
            JSON.stringify({ name: "async-adapter", type: "module", main: "index.js" }),
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
});
