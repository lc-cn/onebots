import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { ExtensionManager, type ExtensionInstaller } from "./extension-manager.js";

const directories: string[] = [];

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
});
