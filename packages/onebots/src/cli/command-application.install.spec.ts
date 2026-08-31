import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    installService,
    restartService,
    startService,
    stopService,
} from "./command-application.js";
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

    it("严格拒绝损坏 YAML 但不把相邻凭据带入安装错误", async () => {
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const config = createConfig("access_token: secret-never-return\nplugins: [\n");

        let error: unknown;
        try {
            await installService(options(config));
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({
            message: expect.stringContaining("服务安装预检失败：YAML 解析失败"),
            exitCode: 2,
        });
        expect((error as Error).message).not.toContain("secret-never-return");
        expect((error as Error).message).not.toContain("plugins: [");
        expect((error as Error).message).not.toContain("\n");
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

    it("installs the plugin selection persisted by setup without repeated flags", async () => {
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const config = createConfig(
            "plugins:\n  adapters: [mock]\n  protocols: [onebot-v11]\ngeneral: {}\n",
        );

        await installService(options(config));

        expect(install).toHaveBeenCalledWith(
            expect.objectContaining({
                configPath: config,
                adapters: ["mock"],
                protocols: ["onebot-v11"],
            }),
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

    it("reports start success only after the new instance is online", async () => {
        const config = createConfig("general: {}\n");
        const spec = serviceSpec(config);
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "inactive",
        });
        const start = vi.spyOn(ServiceController.prototype, "start").mockResolvedValue();
        const readInstanceId = vi.fn(async () => "occupied-instance");
        const verifyOnline = vi.fn(async () => undefined);

        await expect(
            startService({ system: false }, { readInstanceId, verifyOnline }),
        ).resolves.toEqual({ output: "OneBots 服务已启动并通过在线验证" });
        expect(start).toHaveBeenCalledOnce();
        expect(verifyOnline).toHaveBeenCalledWith(spec, expect.any(String), "occupied-instance");
    });

    it("keeps start idempotent when the installed service is already online", async () => {
        const config = createConfig("general: {}\n");
        const spec = serviceSpec(config);
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: true,
            scope: "user",
            detail: "active",
        });
        const start = vi.spyOn(ServiceController.prototype, "start").mockResolvedValue();
        const readInstanceId = vi.fn(async () => "current-instance");
        const verifyOnline = vi.fn(async () => undefined);

        await expect(
            startService({ system: false }, { readInstanceId, verifyOnline }),
        ).resolves.toEqual({ output: "OneBots 服务已在运行并通过在线验证" });
        expect(start).not.toHaveBeenCalled();
        expect(readInstanceId).not.toHaveBeenCalled();
        expect(verifyOnline).toHaveBeenCalledWith(spec, expect.any(String), null);
    });

    it("reports restart failure after the control command when the instance does not switch", async () => {
        const config = createConfig("general: {}\n");
        const spec = serviceSpec(config);
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        const restart = vi.spyOn(ServiceController.prototype, "restart").mockResolvedValue();

        await expect(
            restartService(
                { system: false },
                {
                    readInstanceId: async () => "old-instance",
                    verifyOnline: async () => {
                        throw new Error("实例仍为 old-instance");
                    },
                },
            ),
        ).rejects.toMatchObject({
            message: expect.stringMatching(
                /服务重启命令已执行，但在线验证失败.*实例仍为 old-instance.*onebots status/,
            ),
            exitCode: 1,
        });
        expect(restart).toHaveBeenCalledOnce();
    });

    it("reports stop success only after the process manager confirms it", async () => {
        const stop = vi.spyOn(ServiceController.prototype, "stop").mockResolvedValue();
        const verifyStopped = vi.fn(async () => undefined);

        await expect(stopService({ system: false }, { verifyStopped })).resolves.toEqual({
            output: "OneBots 服务已停止并通过状态验证",
        });
        expect(stop).toHaveBeenCalledOnce();
        expect(verifyStopped).toHaveBeenCalledOnce();
    });

    it("preserves process-manager evidence when stop verification fails", async () => {
        const stop = vi.spyOn(ServiceController.prototype, "stop").mockResolvedValue();

        await expect(
            stopService(
                { system: false },
                {
                    verifyStopped: async () => {
                        throw new Error("launchd 仍报告运行中");
                    },
                },
            ),
        ).rejects.toMatchObject({
            message: expect.stringMatching(
                /服务停止命令已执行，但状态验证失败.*launchd 仍报告运行中.*onebots status/,
            ),
            exitCode: 1,
        });
        expect(stop).toHaveBeenCalledOnce();
    });
});
