import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import {
    ExtensionManager,
    preflightExtensionConfig,
    type ExtensionConfigPreflight,
    type ExtensionInstaller,
} from "./extension-manager.js";
import type { ServicePreflightSpec } from "./service-preflight.js";

const directories: string[] = [];
const successfulPreflight: ExtensionConfigPreflight = async () => undefined;

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-extensions-"));
    directories.push(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"private":true}\n');
    const configPath = path.join(root, "config.yaml");
    fs.writeFileSync(
        configPath,
        "plugins:\n  adapters: []\n  protocols: [onebot-v11]\ngeneral: {}\n",
    );
    return { root, configPath };
}

describe("ExtensionManager", () => {
    it("候选配置临时文件使用私有权限并在预检失败后清理", async () => {
        const { root, configPath } = fixture();
        let temporaryPath = "";
        const runPreflight = vi.fn(async (spec: ServicePreflightSpec) => {
            temporaryPath = spec.configPath;
            expect(fs.statSync(temporaryPath).mode & 0o777).toBe(0o600);
            expect(fs.readFileSync(temporaryPath, "utf8")).toContain("access_token: secret");
            throw new Error("候选插件损坏");
        });

        await expect(
            preflightExtensionConfig(
                {
                    content: "access_token: secret\n",
                    selection: { adapters: ["slack"], protocols: [] },
                    runtimeRoot: root,
                    configPath,
                },
                runPreflight,
            ),
        ).rejects.toThrow("候选插件损坏");

        expect(runPreflight).toHaveBeenCalledOnce();
        expect(temporaryPath).not.toBe("");
        expect(fs.existsSync(temporaryPath)).toBe(false);
    });

    it("只安装目录中的固定包名并持久化插件选择", async () => {
        const { root, configPath } = fixture();
        const install = vi.fn(async (packageName: string, runtimeRoot: string) => {
            const packageDirectory = path.join(
                runtimeRoot,
                "node_modules",
                ...packageName.split("/"),
            );
            fs.mkdirSync(packageDirectory, { recursive: true });
            fs.writeFileSync(path.join(packageDirectory, "package.json"), "{}\n");
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install } satisfies ExtensionInstaller,
            preflight: successfulPreflight,
        });

        await expect(manager.install("adapter:slack")).resolves.toEqual({
            restartRequired: true,
        });
        expect(install).toHaveBeenCalledWith("@onebots/adapter-slack", root);
        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config.plugins).toEqual({
            adapters: ["slack"],
            protocols: ["onebot-v11"],
        });
        expect(manager.list([]).find(item => item.id === "adapter:slack")).toMatchObject({
            installed: true,
            enabled: true,
            loaded: false,
        });
    });

    it("拒绝任意 npm 包名", async () => {
        const { root, configPath } = fixture();
        const install = vi.fn();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await expect(manager.install("adapter:slack@latest;rm -rf /")).rejects.toThrow(
            "不允许从管理端安装",
        );
        expect(install).not.toHaveBeenCalled();
    });

    it("已安装依赖只启用配置，不重复调用 npm", async () => {
        const { root, configPath } = fixture();
        const packageDirectory = path.join(root, "node_modules", "@onebots", "adapter-slack");
        fs.mkdirSync(packageDirectory, { recursive: true });
        fs.writeFileSync(path.join(packageDirectory, "package.json"), "{}\n");
        const install = vi.fn();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await manager.install("adapter:slack");
        expect(install).not.toHaveBeenCalled();
    });

    it("配置无效时不开始安装，避免留下半完成依赖", async () => {
        const { root, configPath } = fixture();
        fs.writeFileSync(configPath, "plugins: []\n");
        const install = vi.fn();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow("plugins 必须是对象");
        expect(install).not.toHaveBeenCalled();
    });

    it("安装期间配置发生变化时合并最新内容", async () => {
        const { root, configPath } = fixture();
        const install = vi.fn(async () => {
            fs.writeFileSync(
                configPath,
                "plugins:\n  adapters: [telegram]\n  protocols: [onebot-v11]\ngeneral:\n  host: 127.0.0.1\n",
            );
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await manager.install("adapter:slack");

        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config).toMatchObject({
            plugins: {
                adapters: ["telegram", "slack"],
                protocols: ["onebot-v11"],
            },
            general: { host: "127.0.0.1" },
        });
    });

    it("候选插件预检失败时不启用配置", async () => {
        const { root, configPath } = fixture();
        const original = fs.readFileSync(configPath, "utf8");
        const install = vi.fn(async () => undefined);
        const preflight = vi.fn(async () => {
            throw new Error("插件没有注册配置 Schema");
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight,
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow("插件没有注册配置 Schema");

        expect(install).toHaveBeenCalledOnce();
        expect(preflight).toHaveBeenCalledWith(
            expect.objectContaining({
                selection: { adapters: ["slack"], protocols: ["onebot-v11"] },
                runtimeRoot: root,
                configPath,
            }),
        );
        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
    });

    it("候选预检期间配置变化时重新合并并验证", async () => {
        const { root, configPath } = fixture();
        const preflight = vi.fn(async () => {
            if (preflight.mock.calls.length === 1) {
                fs.writeFileSync(
                    configPath,
                    "plugins:\n  adapters: [telegram]\n  protocols: [onebot-v11]\ngeneral: {}\n",
                );
            }
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install: vi.fn(async () => undefined) },
            preflight,
        });

        await manager.install("adapter:slack");

        expect(preflight).toHaveBeenCalledTimes(2);
        expect(preflight).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                selection: expect.objectContaining({ adapters: ["telegram", "slack"] }),
            }),
        );
        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config.plugins).toEqual({
            adapters: ["telegram", "slack"],
            protocols: ["onebot-v11"],
        });
    });
});
