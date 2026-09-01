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
});

describe("Windows user task persistence", () => {
    it("同时验证并原子恢复计划任务 XML 与 runner", async () => {
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
        const runner = path.join(paths.stateDir, "onebots-runner.cmd");
        expect(controller.definitionIsCurrent(spec)).toBe(true);

        fs.writeFileSync(runner, "tampered runner", "utf8");
        expect(controller.definitionIsCurrent(spec)).toBe(false);
        await controller.install(spec);
        expect(controller.definitionIsCurrent(spec)).toBe(true);

        fs.writeFileSync(paths.definition, "tampered xml", "utf16le");
        expect(controller.definitionIsCurrent(spec)).toBe(false);
        await controller.install(spec);

        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(fs.readdirSync(paths.stateDir).sort()).toEqual([
            "onebots-runner.cmd",
            "onebots-service.xml",
            "service.json",
        ]);
        expect(host.exec).toHaveBeenCalledWith(
            "schtasks.exe",
            ["/Create", "/F", "/TN", "OneBots Gateway", "/XML", paths.definition],
            { inherit: true },
        );
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
