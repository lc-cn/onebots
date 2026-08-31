import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installService } from "./command-application.js";
import { ServiceController } from "../service-manager.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createConfig(source: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-install-preflight-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, source, "utf8");
    return configPath;
}

function createPlugin(configPath: string, source: string): string {
    const pluginPath = path.join(path.dirname(configPath), "plugin.mjs");
    fs.writeFileSync(pluginPath, source, "utf8");
    return pluginPath;
}

function options(config: string, register: string[] = [], protocol: string[] = []) {
    return { config, register, protocol, system: false };
}

describe("service install preflight", () => {
    it("validates configuration before writing a service definition", async () => {
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const config = createConfig("- invalid-root\n");

        await expect(installService(options(config))).rejects.toMatchObject({
            message: expect.stringMatching(/服务安装预检失败.*配置根节点必须是对象/),
            exitCode: 2,
        });
        expect(install).not.toHaveBeenCalled();
    });

    it("waits for plugin initialization before writing a service definition", async () => {
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const config = createConfig("general: {}\n");
        const plugin = createPlugin(
            config,
            'await Promise.resolve(); throw new Error("plugin initialization failed");',
        );

        await expect(installService(options(config, [plugin]))).rejects.toMatchObject({
            message: expect.stringMatching(/服务安装预检失败.*无法加载插件/),
            exitCode: 2,
        });
        expect(install).not.toHaveBeenCalled();
    });

    it("writes the service definition only after preflight succeeds", async () => {
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const config = createConfig("general: {}\n");

        await expect(installService(options(config))).resolves.toMatchObject({
            output: expect.stringContaining("已安装用户级 OneBots 服务"),
        });
        expect(install).toHaveBeenCalledOnce();
        expect(install).toHaveBeenCalledWith(
            expect.objectContaining({ configPath: config, adapters: [], protocols: [] }),
        );
    });
});
