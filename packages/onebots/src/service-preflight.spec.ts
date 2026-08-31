import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import { preflightServiceRuntime, preflightServiceRuntimeIsolated } from "./service-preflight.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    AdapterRegistry.clear();
    ProtocolRegistry.clear();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("service runtime preflight", () => {
    it("在独立 CLI 进程中使用真实工作目录和完整插件选择", async () => {
        const execute = vi.fn(async () => ({ stdout: "", stderr: "" }));

        await preflightServiceRuntimeIsolated(
            {
                configPath: "/srv/onebots/config.yaml",
                adapters: ["slack", "telegram"],
                protocols: ["onebot-v11"],
                workingDirectory: "/srv/onebots/runtime",
            },
            {
                nodePath: "/opt/node/bin/node",
                binPath: "/srv/onebots/runtime/node_modules/onebots/lib/bin.js",
                execute,
            },
        );

        expect(execute).toHaveBeenCalledWith(
            "/opt/node/bin/node",
            [
                "/srv/onebots/runtime/node_modules/onebots/lib/bin.js",
                "--service-runtime",
                "preflight",
                "-c",
                "/srv/onebots/config.yaml",
                "-r",
                "slack",
                "-r",
                "telegram",
                "-p",
                "onebot-v11",
            ],
            expect.objectContaining({
                cwd: "/srv/onebots/runtime",
                timeout: 60_000,
            }),
        );
    });

    it("从隔离进程 stderr 提取可操作诊断", async () => {
        const execute = vi.fn(async () => {
            throw Object.assign(new Error("Command failed"), {
                stderr: "runtime warning\n[onebots] 插件加载失败：adapter:slack 入口损坏\n",
            });
        });

        await expect(
            preflightServiceRuntimeIsolated(
                {
                    configPath: "/srv/onebots/config.yaml",
                    adapters: ["slack"],
                    protocols: [],
                    workingDirectory: "/srv/onebots/runtime",
                },
                { binPath: "/srv/onebots/bin.js", execute },
            ),
        ).rejects.toThrow("插件加载失败：adapter:slack 入口损坏");
    });

    it("resolves import-only plugins from the installed service working directory", async () => {
        const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cwd-"));
        temporaryDirectories.push(workingDirectory);
        const configPath = path.join(workingDirectory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", "utf8");

        const packageDirectory = path.join(workingDirectory, "node_modules", "custom-adapter");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({
                name: "custom-adapter",
                type: "module",
                exports: { ".": { import: "./index.js" } },
            }),
        );
        fs.writeFileSync(
            path.join(packageDirectory, "index.js"),
            "await Promise.resolve(); export const loaded = true;\n",
        );
        AdapterRegistry.register("custom-adapter", (() => undefined) as never);
        AdapterRegistry.registerSchema("custom-adapter", {});
        const callerWorkingDirectory = process.cwd();

        await expect(
            preflightServiceRuntime({
                configPath,
                adapters: ["custom-adapter"],
                protocols: [],
                workingDirectory,
            }),
        ).resolves.toBeUndefined();
        expect(process.cwd()).toBe(callerWorkingDirectory);
    });

    it("rejects an importable plugin that does not fulfil its registration contract", async () => {
        const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cwd-"));
        temporaryDirectories.push(workingDirectory);
        const configPath = path.join(workingDirectory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", "utf8");

        const packageDirectory = path.join(workingDirectory, "node_modules", "empty-adapter");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({ name: "empty-adapter", type: "module", exports: "./index.js" }),
        );
        fs.writeFileSync(path.join(packageDirectory, "index.js"), "export {};\n");

        await expect(
            preflightServiceRuntime({
                configPath,
                adapters: ["empty-adapter"],
                protocols: [],
                workingDirectory,
            }),
        ).rejects.toThrow("已初始化，但没有注册适配器 empty-adapter");
    });
});
