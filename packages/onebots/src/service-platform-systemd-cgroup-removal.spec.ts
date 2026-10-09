import { expect, it, vi } from "vitest";
import type { ServiceHost } from "./service-host.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { isNaturalSystemdTransition } from "./service-platform-systemd-observation.js";

const definition = "/etc/systemd/system/onebots-gateway.service";
const group = "/system.slice/onebots-gateway.service";

it("同一 unit 自然崩溃到 failed 终态时允许丢弃旧 cgroup 证据并重读", () => {
    const stable = {
        LoadState: "loaded",
        FragmentPath: definition,
        UnitFileState: "enabled",
        ActiveState: "active",
        SubState: "running",
        MainPID: "123",
        ControlPID: "0",
        ControlGroup: group,
        InvocationID: "a".repeat(32),
    };
    expect(
        isNaturalSystemdTransition(stable, {
            ...stable,
            ActiveState: "failed",
            SubState: "failed",
            MainPID: "0",
            ControlGroup: "",
            InvocationID: "",
        }),
    ).toBe(true);
});

it.each([false, true, "group"])(
    "读取 cgroup 时自然停态变迁重观测但实例换代仍拒绝（replacement=%s）",
    async replacement => {
        let enabled = true;
        let stopping = false;
        let changed = false;
        const exec = vi.fn((_file: string, args: string[]) => {
            if (args.includes("disable")) enabled = false;
            if (args.includes("stop")) stopping = true;
            if (!args.includes("show")) return "";
            return (
                Object.entries({
                    ActiveState:
                        changed && !replacement ? "inactive" : stopping ? "deactivating" : "active",
                    SubState:
                        changed && !replacement ? "dead" : stopping ? "stop-sigterm" : "running",
                    MainPID: changed && !replacement ? "0" : "123",
                    ControlPID: "0",
                    ControlGroup:
                        changed && replacement === "group"
                            ? "/system.slice/replacement.service"
                            : group,
                    UnitFileState: enabled ? "enabled" : "disabled",
                    FragmentPath: definition,
                    InvocationID: changed
                        ? replacement === true
                            ? "b".repeat(32)
                            : replacement === "group"
                              ? "a".repeat(32)
                              : ""
                        : "a".repeat(32),
                    LoadState: "loaded",
                })
                    .map(([key, value]) => `${key}=${value}`)
                    .join("\n") + "\n"
            );
        });
        const host: ServiceHost = {
            platform: "linux",
            homedir: "/root",
            uid: 0,
            env: {},
            exec,
            spawn: async () => {
                throw new Error("不应调用 spawn");
            },
        };
        const platform = new SystemdServicePlatform(host, "system", definition, {
            readFile: async () => {
                if (stopping && !changed) {
                    changed = true;
                    return "populated 0\n";
                }
                return changed && !replacement ? null : "populated 1\n";
            },
        });
        if (replacement) await expect(platform.quiesce()).rejects.toThrow("无法安全确认");
        else {
            await platform.quiesce();
            expect(await platform.inspect()).toMatchObject({ quiescent: true, enabled: false });
        }
        expect(exec.mock.calls.filter(call => call[1].includes("stop"))).toHaveLength(1);
    },
);

it("持续自然状态变化只重读三次，拒绝不稳定证据且不重复 stop", async () => {
    let enabled = true;
    let stopping = false;
    let reads = 0;
    const exec = vi.fn((_file: string, args: string[]) => {
        if (args.includes("disable")) enabled = false;
        if (args.includes("stop")) stopping = true;
        if (!args.includes("show")) return "";
        return (
            Object.entries({
                ActiveState: stopping ? "deactivating" : "active",
                SubState: stopping ? "stop-sigterm" : "running",
                MainPID: String(123 + reads),
                ControlPID: "0",
                ControlGroup: group,
                UnitFileState: enabled ? "enabled" : "disabled",
                FragmentPath: definition,
                InvocationID: "a".repeat(32),
                LoadState: "loaded",
            })
                .map(([key, value]) => `${key}=${value}`)
                .join("\n") + "\n"
        );
    });
    const host: ServiceHost = {
        platform: "linux",
        homedir: "/root",
        uid: 0,
        env: {},
        exec,
        spawn: async () => {
            throw new Error("不应调用 spawn");
        },
    };
    const platform = new SystemdServicePlatform(host, "system", definition, {
        readFile: async () => {
            if (stopping) reads++;
            return "populated 1\n";
        },
    });
    await expect(platform.quiesce()).rejects.toThrow("无法安全确认");
    expect(reads).toBe(3);
    expect(exec.mock.calls.filter(call => call[1].includes("stop"))).toHaveLength(1);
});

it("停止后仍保留 ControlGroup 属性但内核 cgroup 已删除时完成静止", async () => {
    let stopped = false;
    let enabled = true;
    let clock = 0;
    const exec = vi.fn((_file: string, args: string[]) => {
        if (args.includes("disable")) enabled = false;
        if (!args.includes("show")) return "";
        return `${Object.entries({
            ActiveState: stopped ? "inactive" : "active",
            SubState: stopped ? "dead" : "running",
            MainPID: stopped ? "0" : "123",
            ControlPID: "0",
            ControlGroup: group,
            UnitFileState: enabled ? "enabled" : "disabled",
            FragmentPath: definition,
            InvocationID: stopped ? "" : "a".repeat(32),
            LoadState: "loaded",
        })
            .map(([key, value]) => `${key}=${value}`)
            .join("\n")}\n`;
    });
    const host: ServiceHost = {
        platform: "linux",
        homedir: "/root",
        uid: 0,
        env: {},
        exec,
        spawn: async () => {
            throw new Error("不应调用 spawn");
        },
    };
    const platform = new SystemdServicePlatform(host, "system", definition, {
        readFile: async () => (stopped ? null : "populated 1\n"),
        now: () => clock,
        sleep: async milliseconds => {
            clock += milliseconds;
            stopped = true;
        },
        stopTimeoutMs: 300,
        forceKillAfterMs: 200,
    });

    await platform.quiesce();

    await expect(platform.inspect()).resolves.toMatchObject({
        state: "stopped",
        enabled: false,
        running: false,
        quiescent: true,
    });
    expect(exec.mock.calls.filter(call => call[1].includes("stop"))).toHaveLength(1);
});
