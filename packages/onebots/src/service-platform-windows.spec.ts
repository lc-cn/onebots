import { describe, expect, it, vi } from "vitest";
import { SERVICE_NAME } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
import {
    renderWindowsManagerServiceDefinition,
    parseWindowsNativeStatus,
    WindowsServicePlatform,
    type WindowsServiceDefinition,
    unregisterWindowsManagerService,
} from "./service-platform-windows.js";

const sid = "S-1-5-21-100-200-300-1001";
const definition: WindowsServiceDefinition = {
    schemaVersion: 1,
    serviceName: SERVICE_NAME,
    hostExecutable: "C:\\OneBots\\lib\\native\\onebots-windows-host.exe",
    managerExecutable: "C:\\Node\\node.exe",
    managerArguments: ["C:\\OneBots\\lib\\bin.js", "serve", "--data-dir", "C:\\Data Dir"],
    workingDirectory: "C:\\OneBots",
    pipeName: `\\\\.\\pipe\\${SERVICE_NAME}-control`,
};

function makeHost(outputs: string[]): ServiceHost {
    return {
        platform: "win32",
        homedir: "C:\\Users\\test",
        isElevated: true,
        windowsSid: sid,
        env: {},
        exec: vi.fn(file => (file === "sc.exe" ? "" : (outputs.shift() ?? ""))),
        spawn: vi.fn(async () => 0),
    };
}

function scm(
    state: "Running" | "Stopped",
    mode: "Auto" | "Manual" | "Disabled",
    pid = 0,
    manager = "C:\\OneBots\\lib\\bin.js",
) {
    return JSON.stringify({
        Name: SERVICE_NAME,
        State: state,
        StartMode: mode,
        ProcessId: pid,
        PathName:
            `C:\\OneBots\\lib\\native\\onebots-windows-host.exe service-run --service-name onebots-gateway --manager C:\\Node\\node.exe --manager-arg ${manager} --manager-arg serve --manager-arg --data-dir --manager-arg "C:\\Data Dir" --working-dir C:\\OneBots --pipe \\\\.\\pipe\\onebots-gateway-control --control-sid ` +
            sid,
    });
}

function native(pid: number) {
    return JSON.stringify({
        version: 1,
        requestId: "status-test",
        ok: true,
        state: {
            service: "running",
            manager: { state: "running", pid },
            startedAt: "2026-09-09T01:02:03Z",
        },
    });
}

describe("Windows SCM TypeScript纵切", () => {
    it("生成宿主定义时逐参数保存manager契约，不拼接shell", () => {
        const rendered = JSON.parse(
            renderWindowsManagerServiceDefinition({
                schemaVersion: 1,
                runtimeKind: "control",
                scope: "system",
                workspace: "/ProgramData/OneBots Data",
                nodePath: "/Program Files/nodejs/node.exe",
                binPath: "/runtime/node_modules/onebots/lib/bin.js",
                workingDirectory: "/runtime",
                host: "127.0.0.1",
                port: 6727,
            }),
        );
        expect(rendered).toEqual({
            schemaVersion: 1,
            serviceName: SERVICE_NAME,
            hostExecutable: `\\runtime\\node_modules\\onebots\\lib\\native\\win32-${process.arch}\\onebots-windows-host.exe`,
            managerExecutable: "/Program Files/nodejs/node.exe",
            managerArguments: [
                "/runtime/node_modules/onebots/lib/bin.js",
                "serve",
                "--data-dir",
                "/ProgramData/OneBots Data",
                "--host",
                "127.0.0.1",
                "--port",
                "6727",
            ],
            workingDirectory: "/runtime",
            pipeName: `\\\\.\\pipe\\${SERVICE_NAME}-control`,
        });
    });

    it("将SCM运行态与受保护管道的manager PID绑定为实例身份", async () => {
        const host = makeHost([scm("Running", "Auto", 4321) + "\r\n", native(8765) + "\r\n"]);
        const platform = new WindowsServicePlatform(host, "system", "C:\\state\\service.json", {
            definition,
        });
        expect(await platform.inspect()).toMatchObject({
            state: "running",
            running: true,
            enabled: true,
            processId: 8765,
            identity: "2026-09-09T01:02:03Z/host:4321/manager:8765",
        });
        expect(host.exec).toHaveBeenNthCalledWith(
            2,
            definition.hostExecutable,
            ["status", "--pipe", definition.pipeName, "--timeout", "5s"],
            { timeoutMs: 6000 },
        );
    });

    it("严格解析同SID管道发布的manager与gateway只读状态", () => {
        const value = JSON.parse(native(8765));
        value.state.control = {
            manager: {
                id: "123e4567-e89b-42d3-a456-426614174000",
                version: "1.2.12",
                pid: 8765,
            },
            gateway: { desired: "running", actual: "stopped" },
        };
        expect(parseWindowsNativeStatus(JSON.stringify(value) + "\r\n").state.control).toEqual(
            value.state.control,
        );
        const wrongPid = structuredClone(value);
        wrongPid.state.control.manager.pid = 9;
        expect(() => parseWindowsNativeStatus(JSON.stringify(wrongPid))).toThrow();
        const wrongVersion = structuredClone(value);
        wrongVersion.state.control.manager.version = "latest";
        expect(() => parseWindowsNativeStatus(JSON.stringify(wrongVersion))).toThrow();
        const wrongGateway = structuredClone(value);
        wrongGateway.state.control.gateway.actual = "unknown";
        expect(() => parseWindowsNativeStatus(JSON.stringify(wrongGateway))).toThrow();
        const extra = structuredClone(value);
        extra.state.control.extra = true;
        expect(() => parseWindowsNativeStatus(JSON.stringify(extra))).toThrow();
    });

    it("管道PID不匹配时只报告转换态，不伪造已就绪", async () => {
        const host = makeHost([
            scm("Running", "Auto", 4321),
            JSON.stringify({
                version: 1,
                requestId: "status-test",
                ok: true,
                state: {
                    service: "running",
                    manager: { state: "running", pid: 0 },
                    startedAt: "2026-09-09T01:02:03Z",
                },
            }),
        ]);
        const platform = new WindowsServicePlatform(host, "system", "C:\\state\\service.json", {
            definition,
        });
        expect(await platform.inspect()).toMatchObject({ state: "transitioning", identity: null });
    });

    it("同名SCM服务的命令行未绑定定义时拒绝控制", async () => {
        const value = JSON.parse(scm("Stopped", "Auto"));
        value.PathName = "C:\\outside\\other.exe";
        const host = makeHost([JSON.stringify(value)]);
        const platform = new WindowsServicePlatform(host, "system", "C:\\state\\service.json", {
            definition,
        });
        await expect(platform.inspect()).rejects.toThrow("无法安全确认");
    });

    it("首次reload通过SCM注册固定宿主，停止态双读后返回", async () => {
        const host = makeHost(["", scm("Stopped", "Auto"), scm("Stopped", "Auto")]);
        const platform = new WindowsServicePlatform(host, "system", "C:\\state\\service.json", {
            definition,
            hostExecutableExists: () => true,
        });
        expect(await platform.reload(true)).toMatchObject({
            loaded: true,
            enabled: true,
            state: "stopped",
        });
        expect(host.exec).toHaveBeenCalledWith(
            "sc.exe",
            expect.arrayContaining([
                "create",
                SERVICE_NAME,
                "binPath=",
                expect.stringContaining("service-run"),
            ]),
            { timeoutMs: 5000 },
        );
        expect((host.exec as ReturnType<typeof vi.fn>).mock.calls[1][1][3]).toContain(
            "--control-sid",
        );
        expect((host.exec as ReturnType<typeof vi.fn>).mock.calls[1][1][3]).toContain(sid);
    });

    it("升级仅在SCM仍绑定旧定义且稳定停止时切到新PathName", async () => {
        const previous: WindowsServiceDefinition = {
            ...definition,
            managerArguments: ["C:\\OneBots\\old\\bin.js", "serve", "--data-dir", "C:\\Data Dir"],
        };
        const host = makeHost([
            scm("Stopped", "Manual", 0, "C:\\OneBots\\old\\bin.js"),
            scm("Stopped", "Auto"),
            scm("Stopped", "Auto"),
        ]);
        const platform = new WindowsServicePlatform(host, "system", "C:\\state\\service.json", {
            definition,
            hostExecutableExists: () => true,
        });
        expect(
            await platform.reloadReplacing(Buffer.from(JSON.stringify(previous)), true),
        ).toMatchObject({ state: "stopped", enabled: true });
        expect(host.exec).toHaveBeenCalledWith(
            "sc.exe",
            expect.arrayContaining([
                "config",
                SERVICE_NAME,
                "binPath=",
                expect.stringContaining("C:\\OneBots\\lib\\bin.js"),
            ]),
            { timeoutMs: 5000 },
        );
        const drifted = makeHost([scm("Stopped", "Manual")]);
        const rejected = new WindowsServicePlatform(drifted, "system", "C:\\state\\service.json", {
            definition,
            hostExecutableExists: () => true,
        });
        await expect(
            rejected.reloadReplacing(Buffer.from(JSON.stringify(previous)), true),
        ).rejects.toThrow("无法安全确认");
        expect(drifted.exec).not.toHaveBeenCalledWith(
            "sc.exe",
            expect.anything(),
            expect.anything(),
        );
    });

    it("拒绝非管理员、user范围和不闭合SCM JSON", async () => {
        const host = makeHost([]);
        host.isElevated = false;
        expect(
            () => new WindowsServicePlatform(host, "system", "C:\\state\\service.json"),
        ).toThrow();
        host.isElevated = true;
        expect(() => new WindowsServicePlatform(host, "user", "C:\\state\\service.json")).toThrow();
        const malformed = makeHost([JSON.stringify({ Name: SERVICE_NAME, State: "Stopped" })]);
        const platform = new WindowsServicePlatform(
            malformed,
            "system",
            "C:\\state\\service.json",
            { definition },
        );
        await expect(platform.inspect()).rejects.toThrow("无法安全确认");
    });

    it("卸载边界只删除固定SCM服务身份", () => {
        const host = makeHost([scm("Stopped", "Manual")]);
        unregisterWindowsManagerService(host, definition);
        expect(host.exec).toHaveBeenLastCalledWith("sc.exe", ["delete", SERVICE_NAME], {
            timeoutMs: 5000,
        });
        const foreign = JSON.parse(scm("Stopped", "Manual"));
        foreign.PathName = "C:\\outside\\service.exe";
        expect(() =>
            unregisterWindowsManagerService(makeHost([JSON.stringify(foreign)]), definition),
        ).toThrow("无法安全确认");
    });
});
