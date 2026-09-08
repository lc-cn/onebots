import { describe, expect, it, vi } from "vitest";
import type { ServiceHost } from "./service-host.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";

const definition = "/home/test/.config/systemd/user/onebots-gateway.service";
const group = "/user.slice/user-1000.slice/user@1000.service/app.slice/onebots-gateway.service";
const invocation = "a".repeat(32);
function properties(overrides: Record<string, string> = {}) {
    return {
        ActiveState: "active",
        SubState: "running",
        MainPID: "123",
        ControlPID: "0",
        ControlGroup: group,
        UnitFileState: "enabled",
        FragmentPath: definition,
        InvocationID: invocation,
        LoadState: "loaded",
        ...overrides,
    };
}
function fixture() {
    let state = properties();
    let events = "populated 1\nfrozen 0\n";
    let clock = 0;
    const exec = vi.fn((_file: string, args: string[], _options?: { timeoutMs?: number }) => {
        if (args.includes("show"))
            return (
                Object.entries(state)
                    .map(([key, value]) => `${key}=${value}`)
                    .join("\n") + "\n"
            );
        if (args.includes("disable")) state.UnitFileState = "disabled";
        if (args.includes("enable")) state.UnitFileState = "enabled";
        return "";
    });
    const host: ServiceHost = {
        platform: "linux",
        homedir: "/home/test",
        uid: 1000,
        env: {},
        exec,
        spawn: async () => {
            throw new Error("不应调用spawn");
        },
    };
    const readFile = vi.fn(async () => events);
    const sleep = vi.fn(async (ms: number) => {
        clock += ms;
    });
    const platform = new SystemdServicePlatform(host, "user", definition, {
        readFile,
        now: () => clock,
        sleep,
        stopTimeoutMs: 300,
    });
    return {
        platform,
        host,
        exec,
        readFile,
        sleep,
        state: (value: Record<string, string>) => {
            state = properties(value);
        },
        events: (value: string) => {
            events = value;
        },
        advance: (ms: number) => {
            clock += ms;
        },
    };
}
describe("systemd服务平台边界", () => {
    it("组合InvocationID、精确定义路径与cgroup证据，命令没有shell", async () => {
        const f = fixture();
        expect(await f.platform.inspect()).toEqual({
            state: "running",
            running: true,
            enabled: true,
            loaded: true,
            definitionPath: definition,
            processId: 123,
            identity: invocation,
            quiescent: false,
        });
        expect(f.readFile).toHaveBeenCalledWith(`/sys/fs/cgroup${group}/cgroup.events`);
        expect(f.exec).toHaveBeenCalledTimes(2);
        expect(f.exec.mock.calls[0].slice(0, 2)).toEqual([
            "systemctl",
            [
                "--no-pager",
                "--no-ask-password",
                "--user",
                "show",
                "--property=ActiveState,SubState,MainPID,ControlPID,ControlGroup,UnitFileState,FragmentPath,InvocationID,LoadState",
                "--",
                "onebots-gateway.service",
            ],
        ]);
    });
    it("failed与正常停止严格区分，过渡状态不能用于推断停止意图", async () => {
        const f = fixture();
        f.events("populated 0\n");
        f.state({ ActiveState: "failed", SubState: "failed", MainPID: "0" });
        expect(await f.platform.inspect()).toMatchObject({
            state: "failed",
            running: false,
            quiescent: true,
        });
        f.state({ ActiveState: "inactive", SubState: "dead", MainPID: "0" });
        expect(await f.platform.inspect()).toMatchObject({
            state: "stopped",
            running: false,
            quiescent: true,
        });
        for (const [ActiveState, SubState] of [
            ["active", "exited"],
            ["activating", "start"],
            ["deactivating", "stop"],
            ["reloading", "reload"],
        ]) {
            f.state({ ActiveState, SubState });
            expect(await f.platform.inspect()).toMatchObject({
                state: "transitioning",
                running: true,
                quiescent: false,
            });
        }
    });
    it("主PID为0仍须确认子树，populated=0且稳定停态才quiescent", async () => {
        const f = fixture();
        f.state({ ActiveState: "inactive", SubState: "dead", MainPID: "0" });
        expect((await f.platform.inspect()).quiescent).toBe(false);
        f.events("populated 0\nfrozen 0\n");
        expect((await f.platform.inspect()).quiescent).toBe(true);
        f.state({ ActiveState: "inactive", SubState: "dead", MainPID: "0", ControlPID: "44" });
        expect((await f.platform.inspect()).quiescent).toBe(false);
        f.state({
            ActiveState: "inactive",
            SubState: "dead",
            MainPID: "0",
            ControlGroup: "",
            InvocationID: "",
        });
        expect((await f.platform.inspect()).quiescent).toBe(true);
    });
    it("缺失字段、未知状态、路径替换、无实例身份不默认为停止", async () => {
        for (const patch of [
            { ActiveState: "unknown" },
            { SubState: "mystery" },
            { LoadState: "error" },
            { LoadState: "masked" },
            { UnitFileState: "static" },
            { UnitFileState: "enabled-runtime" },
            { FragmentPath: "/tmp/other.service" },
            { InvocationID: "" },
            { InvocationID: "0".repeat(32) },
            { MainPID: "-1" },
            { MainPID: "1.5" },
            { ControlPID: "9007199254740993" },
        ]) {
            const f = fixture();
            f.state(patch);
            await expect(f.platform.inspect()).rejects.toThrow("无法安全确认");
        }
        const f = fixture();
        f.exec.mockReturnValue("ActiveState=inactive\n");
        await expect(f.platform.inspect()).rejects.toThrow("无法安全确认");
    });
    it("仅完整not-found+inactive零PID且无cgroup可表示未安装", async () => {
        const f = fixture();
        f.state({
            ActiveState: "inactive",
            SubState: "dead",
            MainPID: "0",
            LoadState: "not-found",
            FragmentPath: "",
            UnitFileState: "",
            ControlGroup: "",
            InvocationID: "",
        });
        expect(await f.platform.inspect()).toMatchObject({
            loaded: false,
            enabled: false,
            quiescent: true,
        });
        await expect(f.platform.start()).rejects.toThrow("无法安全确认");
    });
    it("拒绝cgroup越界、坏内核值和读取失败，错误不泄漏OS文本", async () => {
        for (const ControlGroup of [
            "relative",
            "/",
            "/../onebots-gateway.service",
            "/x/./onebots-gateway.service",
            "/x//onebots-gateway.service",
            "/x/other.service",
            "/x/\\onebots-gateway.service",
        ]) {
            const f = fixture();
            f.state({ ControlGroup });
            await expect(f.platform.inspect()).rejects.toThrow("无法安全确认");
            expect(f.readFile).not.toHaveBeenCalled();
        }
        for (const text of ["", "frozen 0\n", "populated 2\n", "populated 0\npopulated 1\n"]) {
            const f = fixture();
            f.events(text);
            await expect(f.platform.inspect()).rejects.toThrow("无法安全确认");
        }
        const f = fixture();
        f.readFile.mockRejectedValue(new Error("secret OS detail"));
        await expect(f.platform.inspect()).rejects.toThrow(/^无法安全确认 systemd 服务状态$/);
        f.exec.mockImplementation(() => {
            throw new Error("secret systemctl detail");
        });
        await expect(f.platform.inspect()).rejects.toThrow(/^无法安全确认 systemd 服务状态$/);
    });
    it("读cgroup过程中换代不能拼成旧实例已停止的证据", async () => {
        const f = fixture();
        f.readFile.mockImplementation(async () => {
            f.state({ InvocationID: "b".repeat(32) });
            return "populated 0\n";
        });
        await expect(f.platform.inspect()).rejects.toThrow("无法安全确认");
    });
    it("先disable再stop，等待旧子树清空后才返回", async () => {
        const f = fixture();
        f.sleep.mockImplementation(async ms => {
            f.advance(ms);
            f.state({
                UnitFileState: "disabled",
                ActiveState: "inactive",
                SubState: "dead",
                MainPID: "0",
            });
            f.events("populated 0\n");
        });
        await f.platform.quiesce();
        const effects = f.exec.mock.calls
            .map(call => call[1])
            .filter(args => !args.includes("show"));
        expect(effects).toEqual([
            [
                "--no-pager",
                "--no-ask-password",
                "--user",
                "disable",
                "--",
                "onebots-gateway.service",
            ],
            [
                "--no-pager",
                "--no-ask-password",
                "--user",
                "stop",
                "--no-block",
                "--",
                "onebots-gateway.service",
            ],
        ]);
        expect(f.sleep).toHaveBeenCalled();
    });
    it("旧子树未清空有界失败，外部换代拒绝继续控制", async () => {
        const f = fixture();
        await expect(f.platform.quiesce()).rejects.toThrow();
        expect(f.sleep.mock.calls.length).toBeLessThanOrEqual(3);
        const other = fixture();
        other.sleep.mockImplementation(async ms => {
            other.advance(ms);
            other.state({ UnitFileState: "disabled", InvocationID: "b".repeat(32) });
        });
        await expect(other.platform.quiesce()).rejects.toThrow("无法安全确认");
    });

    it("每次systemctl有超时，初始检查也消耗停止总时限，耗尽后不执行副作用", async () => {
        const f = fixture();
        await f.platform.inspect();
        expect(f.exec.mock.calls[0][2]).toEqual({ timeoutMs: 5000 });
        f.exec.mockClear();
        f.readFile.mockImplementation(async () => {
            f.advance(250);
            return "populated 1\n";
        });
        const original = f.exec.getMockImplementation()!;
        f.exec.mockImplementation((file, args, options) => {
            const result = original(file, args, options);
            if (options?.timeoutMs === 50) f.advance(50);
            return result;
        });
        await expect(f.platform.quiesce()).rejects.toThrow();
        expect(f.exec.mock.calls.map(call => call[2]?.timeoutMs)).toEqual([300, 50]);
        expect(f.exec.mock.calls.flatMap(call => call[1])).not.toContain("disable");
    });
    it("reload只重读及恢复启用状态，不隐式start；start固定原位单元", async () => {
        const f = fixture();
        await f.platform.reload(false);
        const actions = f.exec.mock.calls.map(call => call[1]);
        expect(actions[0]).toContain("daemon-reload");
        expect(actions[1]).toContain("disable");
        expect(actions.flat()).not.toContain("start");
        f.state({
            ActiveState: "inactive",
            SubState: "dead",
            MainPID: "0",
            ControlGroup: "",
            InvocationID: "",
        });
        await f.platform.start();
        expect(f.exec.mock.calls.at(-1)?.[1]).toEqual([
            "--no-pager",
            "--no-ask-password",
            "--user",
            "start",
            "--no-block",
            "--",
            "onebots-gateway.service",
        ]);
        const system = new SystemdServicePlatform(f.host, "system", definition, {
            readFile: f.readFile,
        });
        await system.inspect();
        expect(f.exec.mock.calls.at(-1)?.[1]).not.toContain("--user");
    });
});
