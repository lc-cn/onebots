import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import { clearLoadedPlugins } from "./plugin-loader.js";
import {
    preflightInstalledServiceRuntime,
    preflightServiceRuntime,
    preflightServiceRuntimeIsolated,
} from "./service-preflight.js";
import type { ServiceSpec } from "./service-manager.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    AdapterRegistry.clear();
    ProtocolRegistry.clear();
    clearLoadedPlugins();
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

    it("在执行入口或加载插件前拒绝服务定义中的旧 Node", async () => {
        const inspectEntry = vi.fn(() => ({
            valid: true,
            check: { name: "service-entry", level: "ok" as const, message: "入口有效" },
        }));
        const runIsolated = vi.fn(async () => undefined);

        await expect(
            preflightInstalledServiceRuntime(installedSpec(), {
                inspectNode: () => ({
                    supported: false,
                    check: {
                        name: "service-node",
                        level: "error",
                        message: "服务定义 /legacy/node：Node.js v22 不受支持",
                    },
                }),
                inspectEntry,
                runIsolated,
            }),
        ).rejects.toThrow("Node.js v22 不受支持");
        expect(inspectEntry).not.toHaveBeenCalled();
        expect(runIsolated).not.toHaveBeenCalled();
    });

    it("在隔离插件预检前拒绝错配或损坏的 OneBots 服务入口", async () => {
        const runIsolated = vi.fn(async () => undefined);

        await expect(
            preflightInstalledServiceRuntime(installedSpec(), {
                inspectNode: () => ({
                    supported: true,
                    check: { name: "service-node", level: "ok", message: "Node 有效" },
                }),
                inspectEntry: () => ({
                    valid: false,
                    check: {
                        name: "service-entry",
                        level: "error",
                        message: "服务入口版本错配，期望 onebots@1.2.8",
                    },
                }),
                runIsolated,
            }),
        ).rejects.toThrow("服务入口版本错配");
        expect(runIsolated).not.toHaveBeenCalled();
    });

    it("使用服务定义保存的 Node、入口、工作目录与插件选择执行隔离预检", async () => {
        const spec = installedSpec();
        const order: string[] = [];
        const runIsolated = vi.fn(async () => {
            order.push("isolated");
        });

        await expect(
            preflightInstalledServiceRuntime(spec, {
                inspectNode: nodePath => {
                    order.push(`node:${nodePath}`);
                    return {
                        supported: true,
                        check: { name: "service-node", level: "ok", message: "Node 有效" },
                    };
                },
                inspectEntry: binPath => {
                    order.push(`entry:${binPath}`);
                    return {
                        valid: true,
                        check: { name: "service-entry", level: "ok", message: "入口有效" },
                    };
                },
                runIsolated,
            }),
        ).resolves.toBeUndefined();
        expect(order).toEqual([`node:${spec.nodePath}`, `entry:${spec.binPath}`, "isolated"]);
        expect(runIsolated).toHaveBeenCalledWith(spec, {
            nodePath: spec.nodePath,
            binPath: spec.binPath,
        });
    });

    it("resolves import-only plugins from the installed service working directory", async () => {
        const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cwd-"));
        temporaryDirectories.push(workingDirectory);
        const configPath = path.join(workingDirectory, "config.yaml");
        fs.writeFileSync(configPath, "access_token: persisted-token\ngeneral: {}\n", {
            mode: 0o600,
        });

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
            "await Promise.resolve(); globalThis.__onebotsRegisterServiceAdapter(); export const loaded = true;\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterServiceAdapter?: () => void;
        };
        globals.__onebotsRegisterServiceAdapter = () => {
            AdapterRegistry.register("custom-adapter", (() => undefined) as never);
            AdapterRegistry.registerSchema("custom-adapter", {});
        };
        const callerWorkingDirectory = process.cwd();

        try {
            await expect(
                preflightServiceRuntime({
                    configPath,
                    adapters: ["custom-adapter"],
                    protocols: [],
                    workingDirectory,
                }),
            ).resolves.toBeUndefined();
            expect(process.cwd()).toBe(callerWorkingDirectory);
        } finally {
            delete globals.__onebotsRegisterServiceAdapter;
        }
    });

    it("在写入服务定义前拒绝缺少账号 ID 的适配器配置键", async () => {
        const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cwd-"));
        temporaryDirectories.push(workingDirectory);
        const configPath = path.join(workingDirectory, "config.yaml");
        fs.writeFileSync(
            configPath,
            "access_token: persisted-token\ngeneral: {}\ncustom-adapter:\n  token: secret\n",
            "utf8",
        );

        const packageDirectory = path.join(workingDirectory, "node_modules", "custom-adapter");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(packageDirectory, "package.json"),
            JSON.stringify({ name: "custom-adapter", type: "module", exports: "./index.js" }),
        );
        fs.writeFileSync(
            path.join(packageDirectory, "index.js"),
            "globalThis.__onebotsRegisterMissingIdAdapter(); export const loaded = true;\n",
        );
        const globals = globalThis as typeof globalThis & {
            __onebotsRegisterMissingIdAdapter?: () => void;
        };
        globals.__onebotsRegisterMissingIdAdapter = () => {
            AdapterRegistry.register("custom-adapter", (() => undefined) as never);
            AdapterRegistry.registerSchema("custom-adapter", {});
        };

        try {
            await expect(
                preflightServiceRuntime({
                    configPath,
                    adapters: ["custom-adapter"],
                    protocols: [],
                    workingDirectory,
                }),
            ).rejects.toThrow(
                "custom-adapter: 账号配置键缺少账号 ID，应使用 custom-adapter.<account_id>",
            );
        } finally {
            delete globals.__onebotsRegisterMissingIdAdapter;
        }
    });

    it("拒绝把当前 shell 的 Secret 当作守护服务持久化凭据", async () => {
        const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cwd-"));
        temporaryDirectories.push(workingDirectory);
        const configPath = path.join(workingDirectory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", "utf8");
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "transient-shell-token");

        await expect(
            preflightServiceRuntime({
                configPath,
                adapters: [],
                protocols: [],
                workingDirectory,
            }),
        ).rejects.toThrow("当前 shell 的 ONEBOTS_ACCESS_TOKEN 不会写入服务定义");
    });

    it.each([
        "access_token: persisted-token\ngeneral: {}\n",
        "username: operator\npassword: persisted-password\ngeneral: {}\n",
    ])("接受配置文件中的完整管理凭据", async config => {
        const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cwd-"));
        temporaryDirectories.push(workingDirectory);
        const configPath = path.join(workingDirectory, "config.yaml");
        fs.writeFileSync(configPath, config, { mode: 0o600 });

        await expect(
            preflightServiceRuntime({
                configPath,
                adapters: [],
                protocols: [],
                workingDirectory,
            }),
        ).resolves.toBeUndefined();
    });

    it.runIf(process.platform !== "win32")(
        "在安装或启动服务前拒绝公开可读的持久化管理凭据",
        async () => {
            const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cwd-"));
            temporaryDirectories.push(workingDirectory);
            const configPath = path.join(workingDirectory, "config.yaml");
            fs.writeFileSync(configPath, "access_token: persisted-token\ngeneral: {}\n", {
                mode: 0o644,
            });

            await expect(
                preflightServiceRuntime({
                    configPath,
                    adapters: [],
                    protocols: [],
                    workingDirectory,
                }),
            ).rejects.toThrow("服务配置中的持久化管理凭据权限不安全：配置文件权限 644");
        },
    );

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

function installedSpec(): ServiceSpec {
    return {
        scope: "user",
        configPath: "/srv/onebots/config.yaml",
        adapters: ["slack"],
        protocols: ["onebot-v11"],
        nodePath: "/opt/node/bin/node",
        binPath: "/srv/onebots/node_modules/onebots/lib/bin.js",
        workingDirectory: "/srv/onebots",
    };
}
