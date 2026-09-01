import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    installService,
    restartService,
    type ServiceActivationDependencies,
    startService,
    stopService,
    uninstallService,
} from "./command-application.js";
import { ServiceController, type ServiceSpec } from "../service-manager.js";
import { preflightServiceRuntime } from "../service-preflight.js";

const temporaryDirectories: string[] = [];

beforeEach(() => {
    vi.spyOn(ServiceController.prototype, "definitionIsCurrent").mockReturnValue(true);
    vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(null);
    vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
        installed: false,
        running: false,
        scope: "user",
        detail: "服务未安装",
    });
});

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
    fs.writeFileSync(configPath, source, { mode: 0o600 });
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

function activationDependencies(
    overrides: Partial<ServiceActivationDependencies> = {},
): ServiceActivationDependencies {
    return {
        preflight: preflightServiceRuntime,
        readInstanceId: async () => null,
        verifyOnline: async () => undefined,
        ...overrides,
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
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");

        await expect(installService(options(config))).resolves.toMatchObject({
            output: expect.stringContaining("已安装用户级 OneBots 服务"),
        });
        expect(install).toHaveBeenCalledOnce();
        expect(install).toHaveBeenCalledWith(
            expect.objectContaining({ configPath: config, adapters: [], protocols: [] }),
        );
    });

    it.runIf(process.platform !== "win32")("凭据权限不安全时不写入服务定义", async () => {
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        fs.chmodSync(config, 0o644);

        await expect(installService(options(config))).rejects.toMatchObject({
            message: expect.stringMatching(
                /服务安装预检失败.*持久化管理凭据权限不安全.*配置文件权限 644/,
            ),
            exitCode: 2,
        });
        expect(install).not.toHaveBeenCalled();
    });

    it("更新运行中的服务定义时明确要求重启应用新定义", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const previous = { ...serviceSpec(config), protocols: ["onebot-v11"] };
        vi.mocked(ServiceController.prototype.readSpec).mockReturnValue(previous);
        vi.mocked(ServiceController.prototype.status).mockReturnValue({
            installed: true,
            running: true,
            scope: "user",
            detail: "active",
        });
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();

        await expect(installService(options(config))).resolves.toEqual({
            output: "已更新用户级 OneBots 服务定义（现有实例仍在运行）\n应用新定义: onebots restart",
        });
        expect(install).toHaveBeenCalledOnce();
    });

    it("幂等安装相同定义时不要求运行中的实例重启", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const previous = serviceSpec(config);
        vi.mocked(ServiceController.prototype.readSpec).mockReturnValue(previous);
        vi.mocked(ServiceController.prototype.status).mockReturnValue({
            installed: true,
            running: true,
            scope: "user",
            detail: "active",
        });
        vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();

        await expect(installService(options(config))).resolves.toEqual({
            output: "已确认用户级 OneBots 服务定义未变化（现有实例继续运行）",
        });
    });

    it("更新停止的服务定义时不会误报新实例已经运行", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const previous = serviceSpec(config);
        vi.mocked(ServiceController.prototype.readSpec).mockReturnValue(previous);
        vi.mocked(ServiceController.prototype.status).mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "inactive",
        });
        vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();

        await expect(installService(options(config))).resolves.toEqual({
            output: "已更新用户级 OneBots 服务定义（服务当前已停止）\n启动: onebots start",
        });
    });

    it("以安装后的权威状态报告平台替换造成的停止", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const previous = { ...serviceSpec(config), protocols: ["onebot-v11"] };
        vi.mocked(ServiceController.prototype.readSpec).mockReturnValue(previous);
        vi.mocked(ServiceController.prototype.status)
            .mockReturnValueOnce({
                installed: true,
                running: true,
                scope: "system",
                detail: "RUNNING",
            })
            .mockReturnValueOnce({
                installed: true,
                running: false,
                scope: "system",
                detail: "STOPPED",
            });
        vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();

        await expect(installService({ ...options(config), system: true })).resolves.toEqual({
            output: "已更新系统级 OneBots 服务定义（服务当前已停止）\n启动: onebots start --system",
        });
    });

    it("安装前状态查询失败时不推断服务已停止", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const previous = serviceSpec(config);
        vi.mocked(ServiceController.prototype.readSpec).mockReturnValue(previous);
        vi.mocked(ServiceController.prototype.status).mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "systemd bus unavailable",
            error: "进程管理器状态查询失败",
        });
        vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();

        await expect(installService(options(config))).resolves.toEqual({
            output: "已更新用户级 OneBots 服务定义（当前运行状态需要验证）\n验证: onebots status",
        });
    });

    it("installs the plugin selection persisted by setup without repeated flags", async () => {
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const config = createConfig(
            "access_token: persisted-token\nplugins:\n  adapters: [mock]\n  protocols: [onebot-v11]\ngeneral: {}\n",
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

        await expect(
            startService({ system: false }, activationDependencies()),
        ).rejects.toMatchObject({
            message: expect.stringMatching(/服务启动预检失败.*配置根节点必须是对象/),
            exitCode: 2,
        });
        expect(start).not.toHaveBeenCalled();
    });

    it("does not stop a running service when restart preflight fails", async () => {
        const config = createConfig("- invalid-root\n");
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(serviceSpec(config));
        const restart = vi.spyOn(ServiceController.prototype, "restart").mockResolvedValue();

        await expect(
            restartService({ system: false }, activationDependencies()),
        ).rejects.toMatchObject({
            message: expect.stringMatching(/服务重启预检失败.*配置根节点必须是对象/),
            exitCode: 2,
        });
        expect(restart).not.toHaveBeenCalled();
    });

    it.each([
        ["启动", startService, "start"],
        ["重启", restartService, "restart"],
    ] as const)("%s 前拒绝漂移的平台服务定义", async (action, command, method) => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const spec = serviceSpec(config);
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.mocked(ServiceController.prototype.definitionIsCurrent).mockReturnValue(false);
        const control = vi.spyOn(ServiceController.prototype, method).mockResolvedValue();

        await expect(command({ system: false }, activationDependencies())).rejects.toMatchObject({
            message: expect.stringMatching(
                new RegExp(
                    `服务${action}预检失败.*服务平台定义与服务元数据不一致.*onebots install`,
                ),
            ),
            exitCode: 2,
        });
        expect(control).not.toHaveBeenCalled();
    });

    it.each([
        ["启动", startService, "start"],
        ["重启", restartService, "restart"],
    ] as const)("%s 前拒绝失效的已保存服务运行时", async (action, command, method) => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(serviceSpec(config));
        const control = vi.spyOn(ServiceController.prototype, method).mockResolvedValue();
        const preflight = vi.fn(async () => {
            throw new Error("服务 Node.js 无法执行: /legacy/node");
        });

        await expect(
            command({ system: false }, activationDependencies({ preflight })),
        ).rejects.toMatchObject({
            message: expect.stringMatching(
                new RegExp(`服务${action}预检失败.*服务 Node.js 无法执行.*legacy/node`),
            ),
            exitCode: 2,
        });
        expect(preflight).toHaveBeenCalledOnce();
        expect(control).not.toHaveBeenCalled();
    });

    it("reports start success only after the new instance is online", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
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
            startService(
                { system: false },
                activationDependencies({ readInstanceId, verifyOnline }),
            ),
        ).resolves.toEqual({ output: "OneBots 服务已启动并通过在线验证" });
        expect(start).toHaveBeenCalledOnce();
        expect(verifyOnline).toHaveBeenCalledWith(spec, expect.any(String), "occupied-instance");
    });

    it("does not start while the process manager cannot prove the current state", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const spec = serviceSpec(config);
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "systemd bus unavailable",
            error: "进程管理器状态查询失败",
        });
        const start = vi.spyOn(ServiceController.prototype, "start").mockResolvedValue();
        const readInstanceId = vi.fn(async () => null);
        const verifyOnline = vi.fn(async () => undefined);

        await expect(
            startService(
                { system: false },
                activationDependencies({ readInstanceId, verifyOnline }),
            ),
        ).rejects.toMatchObject({
            message: expect.stringMatching(
                /无法确认服务当前状态.*进程管理器状态查询失败.*systemd bus unavailable.*未执行启动命令/,
            ),
            exitCode: 1,
        });
        expect(start).not.toHaveBeenCalled();
        expect(readInstanceId).not.toHaveBeenCalled();
        expect(verifyOnline).not.toHaveBeenCalled();
    });

    it("keeps start idempotent when the installed service is already online", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
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
            startService(
                { system: false },
                activationDependencies({ readInstanceId, verifyOnline }),
            ),
        ).resolves.toEqual({ output: "OneBots 服务已在运行并通过在线验证" });
        expect(start).not.toHaveBeenCalled();
        expect(readInstanceId).not.toHaveBeenCalled();
        expect(verifyOnline).toHaveBeenCalledWith(spec, expect.any(String), null);
    });

    it("reports restart failure after the control command when the instance does not switch", async () => {
        const config = createConfig("access_token: persisted-token\ngeneral: {}\n");
        const spec = serviceSpec(config);
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        const restart = vi.spyOn(ServiceController.prototype, "restart").mockResolvedValue();

        await expect(
            restartService(
                { system: false },
                activationDependencies({
                    readInstanceId: async () => "old-instance",
                    verifyOnline: async () => {
                        throw new Error("实例仍为 old-instance");
                    },
                }),
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

    it("只有卸载事务确认停止并完成清理后才报告成功", async () => {
        const uninstall = vi.spyOn(ServiceController.prototype, "uninstall").mockResolvedValue();

        await expect(uninstallService({ system: false })).resolves.toEqual({
            output: "OneBots 服务已确认停止并卸载，配置和数据已保留",
        });
        expect(uninstall).toHaveBeenCalledOnce();
    });
});
