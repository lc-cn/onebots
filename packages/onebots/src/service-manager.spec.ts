import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceController, type ServiceSpec } from "./service-manager.js";
import type { ServiceHost } from "./service-host.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe.runIf(process.platform !== "win32")("service definition persistence", () => {
    it("原子替换并收紧既有 systemd unit 的危险权限", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-manager-"));
        temporaryDirectories.push(root);
        const host = linuxHost(root);
        const controller = new ServiceController("user", host);
        const spec: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "/opt/node/bin/node",
            binPath: "/opt/onebots/lib/bin.js",
            workingDirectory: root,
        };

        await controller.install(spec);
        const definition = controller.paths().definition;
        expect(fs.statSync(definition).mode & 0o777).toBe(0o644);
        expect(controller.definitionIsCurrent(spec)).toBe(true);

        fs.chmodSync(definition, 0o666);
        await controller.install(spec);

        expect(fs.statSync(definition).mode & 0o777).toBe(0o644);
        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(fs.readdirSync(path.dirname(definition))).toEqual([path.basename(definition)]);
    });

    it("平台命令失败时恢复上一份定义与元数据", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-rollback-"));
        temporaryDirectories.push(root);
        let failNextEnable = false;
        const exec = vi.fn((_file: string, args: string[]) => {
            if (failNextEnable && args.includes("enable")) {
                failNextEnable = false;
                throw new Error("injected enable failure");
            }
            return "";
        });
        const controller = new ServiceController("user", { ...linuxHost(root), exec });
        const previous: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "previous.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "/opt/node/bin/node",
            binPath: "/opt/onebots/lib/bin.js",
            workingDirectory: root,
        };
        await controller.install(previous);

        failNextEnable = true;
        await expect(
            controller.install({ ...previous, configPath: path.join(root, "candidate.yaml") }),
        ).rejects.toThrow("injected enable failure");

        expect(controller.readSpec()).toEqual(previous);
        expect(controller.definitionIsCurrent(previous)).toBe(true);
        expect(exec.mock.calls.filter(([, args]) => args.includes("enable"))).toHaveLength(3);
    });

    it("首次安装失败时清理孤立定义且不提交元数据", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-cleanup-"));
        temporaryDirectories.push(root);
        const exec = vi.fn((_file: string, args: string[]) => {
            if (args.includes("enable")) throw new Error("injected first install failure");
            return "";
        });
        const controller = new ServiceController("user", { ...linuxHost(root), exec });
        const candidate: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "/opt/node/bin/node",
            binPath: "/opt/onebots/lib/bin.js",
            workingDirectory: root,
        };

        await expect(controller.install(candidate)).rejects.toThrow(
            "injected first install failure",
        );

        expect(fs.existsSync(controller.paths().definition)).toBe(false);
        expect(fs.existsSync(controller.paths().metadata)).toBe(false);
        expect(controller.status()).toMatchObject({ installed: false, running: false });
        expect(exec.mock.calls.some(([, args]) => args.includes("disable"))).toBe(true);
    });

    it("停止状态无法验证时保留平台定义与私有元数据", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-uninstall-guard-"));
        temporaryDirectories.push(root);
        const host = linuxHost(root);
        const controller = new ServiceController("user", host);
        const spec: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "/opt/node/bin/node",
            binPath: "/opt/onebots/lib/bin.js",
            workingDirectory: root,
        };
        await controller.install(spec);
        const paths = controller.paths();

        await expect(
            controller.uninstall({
                verifyStopped: async () => {
                    throw new Error("systemd 仍报告 active");
                },
            }),
        ).rejects.toThrow("服务卸载已中止，平台定义和元数据已保留：systemd 仍报告 active");

        expect(fs.existsSync(paths.definition)).toBe(true);
        expect(fs.existsSync(paths.metadata)).toBe(true);
        expect(controller.readSpec()).toEqual(spec);
        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(host.exec).not.toHaveBeenCalledWith(
            "systemctl",
            ["--user", "disable", "onebots-gateway"],
            expect.anything(),
        );
    });

    it("systemd 定义删除失败时恢复定义并保留私有元数据", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-uninstall-restore-"));
        temporaryDirectories.push(root);
        let failDisable = false;
        const exec = vi.fn((_file: string, args: string[]) => {
            if (failDisable && args.includes("disable")) {
                failDisable = false;
                throw new Error("systemctl disable failed");
            }
            return "";
        });
        const controller = new ServiceController("user", { ...linuxHost(root), exec });
        const spec: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "/opt/node/bin/node",
            binPath: "/opt/onebots/lib/bin.js",
            workingDirectory: root,
        };
        await controller.install(spec);
        failDisable = true;

        await expect(
            controller.uninstall({ verifyStopped: async () => undefined }),
        ).rejects.toThrow("服务卸载失败，已恢复平台定义并保留私有元数据：systemctl disable failed");

        expect(controller.readSpec()).toEqual(spec);
        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(exec).toHaveBeenCalledWith("systemctl", ["--user", "disable", "onebots-gateway"], {
            inherit: true,
            ignoreError: false,
        });
        expect(exec.mock.calls.filter(([, args]) => args.includes("enable"))).toHaveLength(2);
    });
});

describe("service status evidence", () => {
    it("distinguishes a failed process-manager query from a confirmed stopped service", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-status-"));
        temporaryDirectories.push(root);
        const host = {
            ...linuxHost(root),
            exec: vi.fn(() => {
                throw new Error("systemd bus unavailable");
            }),
        };
        const controller = new ServiceController("user", host);
        const spec: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config.yaml"),
            adapters: [],
            protocols: [],
            nodePath: process.execPath,
            binPath: process.argv[1],
            workingDirectory: root,
        };

        expect(controller.status(spec)).toEqual({
            installed: true,
            running: false,
            scope: "user",
            detail: "systemd bus unavailable",
            error: "进程管理器状态查询失败",
        });
    });

    it("treats a known unloaded launchd job as authoritatively stopped", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-launchd-status-"));
        temporaryDirectories.push(root);
        const commandError = Object.assign(new Error("launchctl failed"), {
            stderr: "Could not find service com.onebots.onebots-gateway in domain for user",
        });
        const controller = new ServiceController("user", {
            platform: "darwin",
            homedir: root,
            uid: 501,
            env: {},
            exec: vi.fn(() => {
                throw commandError;
            }),
            spawn: vi.fn(async () => 0),
        });
        const spec: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config.yaml"),
            adapters: [],
            protocols: [],
            nodePath: process.execPath,
            binPath: process.argv[1],
            workingDirectory: root,
        };

        expect(controller.status(spec)).toEqual({
            installed: true,
            running: false,
            scope: "user",
            detail: "launchd 任务未加载",
        });
    });
});

describe("Windows user task persistence", () => {
    it("同时验证并原子恢复计划任务 XML 与无 shell runner", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-windows-service-"));
        temporaryDirectories.push(root);
        const host = windowsHost(root);
        const controller = new ServiceController("user", host);
        const spec: ServiceSpec = {
            scope: "user",
            configPath: "C:\\One Bots\\config.yaml",
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "C:\\Program Files\\nodejs\\node.exe",
            binPath: "C:\\One Bots\\lib\\bin.js",
            workingDirectory: "C:\\One Bots",
        };

        await controller.install(spec);
        const paths = controller.paths();
        const runner = path.join(paths.stateDir, "onebots-user-runner.mjs");
        expect(controller.definitionIsCurrent(spec)).toBe(true);

        fs.writeFileSync(runner, "tampered runner", "utf8");
        fs.writeFileSync(path.join(paths.stateDir, "onebots-runner.cmd"), "legacy runner", "utf8");
        expect(controller.definitionIsCurrent(spec)).toBe(false);
        await controller.install(spec);
        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(fs.existsSync(path.join(paths.stateDir, "onebots-runner.cmd"))).toBe(false);

        fs.writeFileSync(paths.definition, "tampered xml", "utf16le");
        expect(controller.definitionIsCurrent(spec)).toBe(false);
        await controller.install(spec);

        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(fs.readdirSync(paths.stateDir).sort()).toEqual([
            "onebots-service.xml",
            "onebots-user-runner.mjs",
            "service.json",
        ]);
        expect(host.exec).toHaveBeenCalledWith(
            "schtasks.exe",
            ["/Create", "/F", "/TN", "OneBots Gateway", "/XML", paths.definition],
            { inherit: true },
        );

        await controller.uninstall();
        expect(fs.readdirSync(paths.stateDir)).toEqual([]);
    });

    it("计划任务删除失败时重新注册任务并保留管理契约", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-windows-uninstall-"));
        temporaryDirectories.push(root);
        let failDelete = false;
        const exec = vi.fn((_file: string, args: string[]) => {
            if (failDelete && args.includes("/Delete")) {
                failDelete = false;
                throw new Error("schtasks delete failed");
            }
            return "";
        });
        const controller = new ServiceController("user", { ...windowsHost(root), exec });
        const spec: ServiceSpec = {
            scope: "user",
            configPath: "C:\\One Bots\\config.yaml",
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "C:\\Program Files\\nodejs\\node.exe",
            binPath: "C:\\One Bots\\lib\\bin.js",
            workingDirectory: "C:\\One Bots",
        };
        await controller.install(spec);
        failDelete = true;

        await expect(
            controller.uninstall({ verifyStopped: async () => undefined }),
        ).rejects.toThrow("服务卸载失败，已恢复平台定义并保留私有元数据：schtasks delete failed");

        expect(controller.readSpec()).toEqual(spec);
        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(exec).toHaveBeenCalledWith(
            "schtasks.exe",
            ["/Delete", "/F", "/TN", "OneBots Gateway"],
            { inherit: true, ignoreError: false },
        );
        expect(exec.mock.calls.filter(([, args]) => args.includes("/Create"))).toHaveLength(2);
    });
});

describe("Windows system service persistence", () => {
    it("使用 node-windows 的真实 WinSW 定义路径而不是状态目录占位文件", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-windows-system-service-"));
        temporaryDirectories.push(root);
        const controller = new ServiceController("system", windowsHost(root));
        const binPath = path.join(root, "onebots", "lib", "bin.js");
        const spec: ServiceSpec = {
            scope: "system",
            configPath: path.join(root, "config.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: path.join(root, "node.exe"),
            binPath,
            workingDirectory: root,
        };
        fs.mkdirSync(controller.paths().stateDir, { recursive: true });
        fs.writeFileSync(controller.paths().definition, "legacy placeholder", "utf8");

        expect(controller.definitionPath(spec)).toBe(
            path.join(path.dirname(binPath), "daemon", "onebotsgateway.xml"),
        );
        expect(controller.definitionIsCurrent(spec)).toBe(false);
    });

    it("使用 node-windows 注册的真实服务 ID 控制生命周期", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-windows-system-control-"));
        temporaryDirectories.push(root);
        const exec = vi.fn((_file: string, args: string[]) =>
            args[0] === "query" ? "STATE : 4 RUNNING" : "",
        );
        const host = { ...windowsHost(root), isElevated: true, exec };
        const controller = new ServiceController("system", host);
        const spec: ServiceSpec = {
            scope: "system",
            configPath: path.join(root, "config.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: path.join(root, "node.exe"),
            binPath: path.join(root, "onebots", "lib", "bin.js"),
            workingDirectory: root,
        };
        fs.mkdirSync(controller.paths().stateDir, { recursive: true });
        fs.writeFileSync(controller.paths().metadata, JSON.stringify(spec), "utf8");

        await controller.start();
        await controller.stop();
        expect(controller.status(spec).running).toBe(true);

        expect(exec).toHaveBeenCalledWith("sc.exe", ["start", "onebotsgateway.exe"], {
            inherit: true,
        });
        expect(exec).toHaveBeenCalledWith("sc.exe", ["stop", "onebotsgateway.exe"], {
            inherit: true,
            ignoreError: false,
        });
        expect(exec).toHaveBeenCalledWith("sc.exe", ["query", "onebotsgateway.exe"]);
    });
});

function linuxHost(root: string): ServiceHost {
    return {
        platform: "linux",
        homedir: root,
        uid: 501,
        env: {
            XDG_STATE_HOME: path.join(root, "state"),
            XDG_CONFIG_HOME: path.join(root, "config"),
        },
        exec: vi.fn(() => ""),
        spawn: vi.fn(async () => 0),
    };
}

function windowsHost(root: string): ServiceHost {
    return {
        platform: "win32",
        homedir: root,
        isElevated: false,
        env: { LOCALAPPDATA: root, ProgramData: root },
        exec: vi.fn(() => ""),
        spawn: vi.fn(async () => 0),
    };
}
