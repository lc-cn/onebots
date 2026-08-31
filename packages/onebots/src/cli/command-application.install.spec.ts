import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installService, restartService, startService } from "./command-application.js";
import { ServiceController, type ServiceSpec } from "../service-manager.js";

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

function serviceSpec(configPath: string): ServiceSpec {
    return {
        scope: "user",
        configPath,
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: process.argv[1],
        workingDirectory: process.cwd(),
    };
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
            message: expect.stringMatching(/服务安装预检失败.*plugin initialization failed/),
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

    it("does not start an installed service after its configuration becomes invalid", async () => {
        const config = createConfig("- invalid-root\n");
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(serviceSpec(config));
        const start = vi.spyOn(ServiceController.prototype, "start").mockResolvedValue();

        await expect(startService({ system: false })).rejects.toMatchObject({
            message: expect.stringMatching(/服务启动预检失败.*配置根节点必须是对象/),
            exitCode: 2,
        });
        expect(start).not.toHaveBeenCalled();
    });

    it("does not stop a running service when restart preflight fails", async () => {
        const config = createConfig("- invalid-root\n");
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(serviceSpec(config));
        const restart = vi.spyOn(ServiceController.prototype, "restart").mockResolvedValue();

        await expect(restartService({ system: false })).rejects.toMatchObject({
            message: expect.stringMatching(/服务重启预检失败.*配置根节点必须是对象/),
            exitCode: 2,
        });
        expect(restart).not.toHaveBeenCalled();
    });
});
