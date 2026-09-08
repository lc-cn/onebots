import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { LAUNCHD_LABEL } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
import {
    LaunchdServicePlatform,
    type LaunchdServicePlatformOptions,
} from "./service-platform-launchd.js";
const definition = `/Users/test/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
const target = `gui/501/${LAUNCHD_LABEL}`;
function fixture(options: LaunchdServicePlatformOptions = {}) {
    const state = {
        loaded: true,
        running: true,
        enabled: true,
        pid: 321,
        pgid: 321,
        leader: true,
        members: true,
        path: definition,
        rawState: "",
        override: "",
        plistDisabled: false,
    };
    let now = 0;
    const calls: string[][] = [];
    const host: ServiceHost = {
        platform: "darwin",
        homedir: "/Users/test",
        uid: 501,
        env: {},
        spawn: async () => {
            throw new Error("must not spawn");
        },
        exec: vi.fn((file, args, commandOptions) => {
            expect(commandOptions?.timeoutMs).toBeGreaterThan(0);
            expect(commandOptions?.timeoutMs).toBeLessThanOrEqual(5000);
            calls.push([file, ...args]);
            if (file === "/usr/bin/plutil")
                return JSON.stringify({ Label: LAUNCHD_LABEL, Disabled: state.plistDisabled });
            if (file === "/bin/ps") return `${state.pid} ${state.pgid}\n`;
            if (args[0] === "print-disabled")
                return `disabled services = {\n "${LAUNCHD_LABEL}" => ${state.override || (state.enabled ? "enabled" : "disabled")}\n}\n`;
            if (args[0] === "print") {
                if (!state.loaded)
                    throw {
                        status: 113,
                        stderr: `Bad request.\nCould not find service "${LAUNCHD_LABEL}" in domain for user gui: 501\n`,
                    };
                return `${target} = {\n path = ${state.path}\n state = ${state.rawState || (state.running ? "running" : "not running")}\n${state.running ? ` pid = ${state.pid}\n` : ""}}\n`;
            }
            if (args[0] === "disable" || args[0] === "enable") state.enabled = args[0] === "enable";
            else if (args[0] === "bootout") {
                state.loaded = false;
                state.running = false;
                state.leader = false;
            } else if (args[0] === "bootstrap") {
                if (!state.enabled) throw new Error("disabled job cannot bootstrap");
                state.loaded = true;
                state.running = true;
                state.leader = true;
                state.members = true;
            } else throw new Error("unexpected command");
            return "";
        }),
    };
    const probes: number[] = [];
    const platform = new LaunchdServicePlatform(host, "user", definition, {
        processExists: pid => {
            probes.push(pid);
            return pid > 0 ? state.leader : state.members;
        },
        now: () => now,
        sleep: async ms => {
            now += ms;
            state.members = false;
        },
        stopTimeoutMs: 300,
        ...options,
    });
    return { state, host, calls, platform, probes };
}

describe("launchd service platform", () => {
    it.each(["not running", "crashed"])(
        "unloads a stable cold %s job before consulting durable process proof",
        async rawState => {
            const proof = vi.fn(async () => {
                expect(f.state.loaded).toBe(false);
                expect(f.calls.some(call => call[1] === "bootout")).toBe(true);
                return true;
            });
            const f = fixture({ confirmUnloadedProcesses: proof });
            Object.assign(f.state, { running: false, rawState });
            expect(await f.platform.inspect()).toMatchObject({
                state: rawState === "crashed" ? "failed" : "stopped",
                quiescent: false,
            });
            expect(proof).not.toHaveBeenCalled();
            await f.platform.quiesce();
            expect(await f.platform.inspect()).toMatchObject({
                state: "stopped",
                loaded: false,
                enabled: false,
                quiescent: true,
            });
            expect(
                f.calls
                    .filter(call => ["disable", "bootout"].includes(call[1]))
                    .map(call => call[1]),
            ).toEqual(["disable", "bootout"]);
            expect(f.probes).toEqual([]); // No PID is guessed for the cold instance.
        },
    );
    it("does not declare a cold failed job stopped when its durable proof stays false", async () => {
        const proof = vi.fn(async () => false);
        const f = fixture({ confirmUnloadedProcesses: proof });
        Object.assign(f.state, { running: false, rawState: "crashed" });
        await expect(f.platform.quiesce()).rejects.toThrow("无法安全确认");
        expect(f.calls.some(call => call[1] === "bootout")).toBe(true);
        expect(proof).toHaveBeenCalled();
        expect((await f.platform.inspect()).quiescent).toBe(false);
    });
    it.each(["pid", "path"])("rejects cold job %s changes before bootout", async change => {
        const f = fixture({ confirmUnloadedProcesses: async () => true });
        Object.assign(f.state, { running: false, rawState: "crashed" });
        const original = f.host.exec;
        f.host.exec = (file, args, options) => {
            const output = original(file, args, options);
            if (args[0] === "disable") {
                if (change === "path") f.state.path = "/other.plist";
                else Object.assign(f.state, { running: true, rawState: "running" });
            }
            return output;
        };
        await expect(f.platform.quiesce()).rejects.toThrow("无法安全确认");
        expect(f.calls.some(call => call[1] === "bootout")).toBe(false);
    });
    it("uses durable manager ownership proof only for an explicitly unloaded cold instance", async () => {
        const proof = vi.fn(async () => true);
        const f = fixture({ confirmUnloadedProcesses: proof });
        Object.assign(f.state, { loaded: false, running: false, enabled: false });
        expect((await f.platform.inspect()).quiescent).toBe(true);
        expect(proof).toHaveBeenCalledTimes(1);
        await f.platform.start();
        expect(await f.platform.inspect()).toMatchObject({ state: "running", enabled: false });
    });
    it("false or throwing ownership proof never yields quiescence", async () => {
        const denied = fixture({ confirmUnloadedProcesses: async () => false });
        Object.assign(denied.state, { loaded: false, running: false });
        expect((await denied.platform.inspect()).quiescent).toBe(false);
        await expect(denied.platform.start()).rejects.toThrow("无法安全确认");
        expect(denied.calls.some(call => ["enable", "bootstrap"].includes(call[1]))).toBe(false);
        const broken = fixture({
            confirmUnloadedProcesses: async () => {
                throw new Error("secret ownership");
            },
        });
        Object.assign(broken.state, { loaded: false, running: false });
        await expect(broken.platform.inspect()).rejects.toThrow(
            /^无法安全确认 launchd 服务及其进程组状态$/,
        );
    });
    it("does not consult proof for loaded, unknown OS, fresh, or surviving known groups", async () => {
        const proof = vi.fn(async () => true);
        const f = fixture({ confirmUnloadedProcesses: proof });
        await f.platform.inspect();
        expect(proof).not.toHaveBeenCalled();
        f.state.running = false; // loaded stopped still must not use workspace proof
        await f.platform.inspect();
        expect(proof).not.toHaveBeenCalled();
        f.state.loaded = false; // historical group remains alive
        expect((await f.platform.inspect()).quiescent).toBe(false);
        expect(proof).not.toHaveBeenCalled();
        f.state.leader = false;
        f.state.members = false;
        expect((await f.platform.inspect()).quiescent).toBe(true);
        expect(proof).toHaveBeenCalledTimes(1);
        proof.mockClear();
        const fresh = fixture({ freshDefinition: true, confirmUnloadedProcesses: proof });
        Object.assign(fresh.state, { loaded: false, running: false });
        expect((await fresh.platform.inspect()).quiescent).toBe(true);
        expect(proof).not.toHaveBeenCalled();
        const unknown = fixture({ confirmUnloadedProcesses: proof });
        unknown.state.rawState = "mystery";
        await expect(unknown.platform.inspect()).rejects.toThrow();
        expect(proof).not.toHaveBeenCalled();
    });
    it("an instance loaded while durable proof is pending invalidates that proof", async () => {
        const f = fixture({
            confirmUnloadedProcesses: async () => {
                f.state.loaded = true;
                f.state.running = true;
                return true;
            },
        });
        Object.assign(f.state, { loaded: false, running: false });
        await expect(f.platform.inspect()).rejects.toThrow("无法安全确认");
        expect(f.calls.some(call => ["enable", "bootstrap", "bootout"].includes(call[1]))).toBe(
            false,
        );
    });
    it("observes fixed identity, path and an independent real ps group", async () => {
        const f = fixture();
        expect(await f.platform.inspect()).toEqual({
            state: "running",
            running: true,
            loaded: true,
            enabled: true,
            definitionPath: definition,
            processId: 321,
            identity: `${target}:pgid:321`,
            quiescent: false,
        });
        expect(f.calls).toContainEqual(["/bin/ps", "-o", "pid=,pgid=", "-p", "321"]);
    });
    it("disables before bootout and waits for helpers after leader exit", async () => {
        const f = fixture();
        await f.platform.quiesce();
        expect(f.calls.findIndex(call => call[1] === "disable")).toBeLessThan(
            f.calls.findIndex(call => call[1] === "bootout"),
        );
        expect(f.probes).toContain(321);
        expect(f.probes).toContain(-321);
        expect((await f.platform.inspect()).quiescent).toBe(true);
        expect(f.calls.some(call => call.includes("kill"))).toBe(false);
    });
    it("never treats a cold missing or stopped legacy instance as proof of empty subtree", async () => {
        for (const loaded of [false, true]) {
            const f = fixture();
            f.state.loaded = loaded;
            f.state.running = false;
            expect((await f.platform.inspect()).quiescent).toBe(false);
            await expect(f.platform.quiesce()).rejects.toThrow("无法安全确认");
            expect(f.calls.some(call => call[1] === "bootout")).toBe(false);
        }
    });
    it("accepts an explicit upper-layer fresh definition proof only before any load", async () => {
        const f = fixture({ freshDefinition: true });
        f.state.loaded = false;
        f.state.running = false;
        expect((await f.platform.inspect()).quiescent).toBe(true);
        await f.platform.quiesce();
        expect(f.state.enabled).toBe(false);
    });
    it("refuses shared process groups and PID 1 without stopping anything", async () => {
        for (const [pid, pgid] of [
            [321, 42],
            [1, 1],
        ]) {
            const f = fixture();
            f.state.pid = pid;
            f.state.pgid = pgid;
            expect((await f.platform.inspect()).identity).toBeNull();
            await expect(f.platform.quiesce()).rejects.toThrow("无法安全确认");
            expect(f.calls.some(call => ["disable", "bootout"].includes(call[1]))).toBe(false);
        }
    });
    it("fails closed on live helpers, unknown probes and command failures", async () => {
        const live = fixture({
            processExists: pid => pid < 0,
            sleep: async () => {},
            now: (() => {
                let n = 0;
                return () => (n += 20);
            })(),
        });
        await expect(live.platform.quiesce()).rejects.toThrow("无法安全确认");
        const denied = fixture({
            processExists: () => {
                throw new Error("EPERM secret");
            },
        });
        await expect(denied.platform.quiesce()).rejects.toThrow(
            /^无法安全确认 launchd 服务及其进程组状态$/,
        );
        const unknown = fixture();
        vi.mocked(unknown.host.exec).mockImplementation(() => {
            throw { status: 5, stderr: "private output" };
        });
        await expect(unknown.platform.inspect()).rejects.toThrow(
            /^无法安全确认 launchd 服务及其进程组状态$/,
        );
    });
    it("reload changes override only, then explicit start bootstraps and verifies", async () => {
        const f = fixture({ freshDefinition: true });
        f.state.loaded = false;
        f.state.running = false;
        await f.platform.reload(false);
        await f.platform.reload(true);
        expect(f.calls.some(call => call[1] === "bootstrap")).toBe(false);
        await f.platform.start();
        expect(f.calls).toContainEqual(["/bin/launchctl", "bootstrap", "gui/501", definition]);
        expect((await f.platform.inspect()).running).toBe(true);
    });
    it("already running disabled job remains unchanged and never uses kickstart -k", async () => {
        const f = fixture();
        f.state.enabled = false;
        await f.platform.start();
        expect(f.state.enabled).toBe(false);
        expect(
            f.calls.some(
                call => ["enable", "disable", "bootstrap"].includes(call[1]) || call.includes("-k"),
            ),
        ).toBe(false);
    });
    it("explicit start temporarily enables an unloaded job then restores disabled intent on the same instance", async () => {
        const f = fixture({ freshDefinition: true });
        f.state.loaded = false;
        f.state.running = false;
        await f.platform.reload(false);
        f.calls.length = 0;
        await f.platform.start();
        expect(
            f.calls.filter(call => ["enable", "bootstrap", "disable"].includes(call[1])),
        ).toEqual([
            ["/bin/launchctl", "enable", target],
            ["/bin/launchctl", "bootstrap", "gui/501", definition],
            ["/bin/launchctl", "disable", target],
        ]);
        expect(await f.platform.inspect()).toMatchObject({
            running: true,
            enabled: false,
            processId: 321,
        });
    });
    it.each(["enable", "bootstrap", "disable"])(
        "unknown %s result rejects without hidden cleanup or retry",
        async action => {
            const f = fixture({ freshDefinition: true });
            Object.assign(f.state, { loaded: false, running: false, enabled: false });
            const original = f.host.exec;
            f.host.exec = (file, args, options) => {
                const output = original(file, args, options);
                if (args[0] === action) throw new Error("secret unknown result");
                return output;
            };
            await expect(f.platform.start()).rejects.toThrow(
                /^无法安全确认 launchd 服务及其进程组状态$/,
            );
            const effects = f.calls
                .filter(call => ["enable", "bootstrap", "disable", "bootout"].includes(call[1]))
                .map(call => call[1]);
            expect(effects).toEqual(
                ["enable", "bootstrap", "disable"].slice(
                    0,
                    ["enable", "bootstrap", "disable"].indexOf(action) + 1,
                ),
            );
        },
    );
    it("restoring disabled state must preserve the observed running instance", async () => {
        const f = fixture({ freshDefinition: true });
        Object.assign(f.state, { loaded: false, running: false, enabled: false });
        const original = f.host.exec;
        f.host.exec = (file, args, options) => {
            const output = original(file, args, options);
            if (args[0] === "disable") {
                f.state.pid++;
                f.state.pgid++;
            }
            return output;
        };
        await expect(f.platform.start()).rejects.toThrow("无法安全确认");
        expect(f.calls.some(call => call[1] === "bootout")).toBe(false);
    });
    it("cold absent legacy job without empty subtree proof must not be enabled or bootstrapped", async () => {
        const f = fixture();
        Object.assign(f.state, { loaded: false, running: false, enabled: false });
        await expect(f.platform.start()).rejects.toThrow("无法安全确认");
        expect(f.calls.some(call => ["enable", "bootstrap"].includes(call[1]))).toBe(false);
    });
    it("refuses mismatched definition, unknown state and malformed disable values", async () => {
        for (const patch of [
            { path: "/wrong.plist" },
            { rawState: "spawning" },
            { override: "unknown" },
        ]) {
            const f = fixture();
            Object.assign(f.state, patch);
            await expect(f.platform.inspect()).rejects.toThrow("无法安全确认");
        }
    });
    it("uses plist Disabled when launchd has no override", async () => {
        const f = fixture();
        const original = f.host.exec;
        f.host.exec = (file, args, options) =>
            args[0] === "print-disabled"
                ? "disabled services = {\n}\n"
                : original(file, args, options);
        f.state.plistDisabled = true;
        expect((await f.platform.inspect()).enabled).toBe(false);
        f.state.plistDisabled = false;
        expect((await f.platform.inspect()).enabled).toBe(true);
    });
    it("rejects instance replacement during the ps observation", async () => {
        const f = fixture();
        const original = f.host.exec;
        f.host.exec = (file, args, options) => {
            const output = original(file, args, options);
            if (file === "/bin/ps") f.state.pid++;
            return output;
        };
        await expect(f.platform.quiesce()).rejects.toThrow("无法安全确认");
        expect(f.calls.some(call => call[1] === "bootout")).toBe(false);
    });
    it("distinguishes failed and transitional instances from a stable stop", async () => {
        for (const [rawState, exitCode, expected] of [
            ["not running", "0", "stopped"],
            ["not running", "1", "failed"],
            ["waiting", "0", "transitioning"],
            ["exited", "0", "transitioning"],
            ["exited", "2", "failed"],
            ["crashed", "0", "failed"],
        ]) {
            const f = fixture();
            f.state.running = false;
            f.state.rawState = rawState;
            const original = f.host.exec;
            f.host.exec = (file, args, options) => {
                const output = original(file, args, options);
                return args[0] === "print"
                    ? output.replace("\n}", `\n last exit code = ${exitCode}\n}`)
                    : output;
            };
            expect((await f.platform.inspect()).state).toBe(expected);
            if (expected !== "stopped") {
                await expect(f.platform.quiesce()).rejects.toThrow("无法安全确认");
                expect(f.calls.some(call => call[1] === "bootout")).toBe(false);
            }
        }
    });
    it("parses boolean disabled overrides", async () => {
        const f = fixture();
        f.state.override = "true";
        expect((await f.platform.inspect()).enabled).toBe(false);
        f.state.override = "false";
        expect((await f.platform.inspect()).enabled).toBe(true);
    });
    it.runIf(process.platform !== "win32")(
        "uses actual ps to identify a detached fixture without touching launchd",
        async () => {
            const child = spawn(
                process.execPath,
                ["-e", "process.stdout.write('ready\\n');setInterval(()=>{},1000)"],
                { detached: true, stdio: ["ignore", "pipe", "ignore"] },
            );
            try {
                await once(child.stdout!, "data");
                const f = fixture();
                f.state.pid = child.pid!;
                f.state.pgid = child.pid!;
                const mock = f.host.exec;
                f.host.exec = (file, args, options) =>
                    file === "/bin/ps"
                        ? execFileSync(file, args, {
                              encoding: "utf8",
                              timeout: options?.timeoutMs,
                          })
                        : mock(file, args, options);
                expect((await f.platform.inspect()).identity).toBe(`${target}:pgid:${child.pid}`);
            } finally {
                const exited = once(child, "exit");
                child.kill("SIGKILL");
                await exited;
            }
        },
    );
});
