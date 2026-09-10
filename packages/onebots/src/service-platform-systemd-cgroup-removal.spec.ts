import { expect, it, vi } from "vitest";
import type { ServiceHost } from "./service-host.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";

const definition = "/etc/systemd/system/onebots-gateway.service";
const group = "/system.slice/onebots-gateway.service";

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
