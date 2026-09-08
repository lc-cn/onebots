import { constants } from "node:fs";
import { open, realpath, statfs } from "node:fs/promises";
import path from "node:path";
import { SERVICE_NAME, type ServiceScope } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";

const UNIT = `${SERVICE_NAME}.service`;
const CGROUP_ROOT = "/sys/fs/cgroup";
const PROPERTIES = [
    "ActiveState",
    "SubState",
    "MainPID",
    "ControlPID",
    "ControlGroup",
    "UnitFileState",
    "FragmentPath",
    "InvocationID",
    "LoadState",
] as const;
type Properties = Record<(typeof PROPERTIES)[number], string>;
export interface SystemdServicePlatformOptions {
    /** 仅接收已检查的 /sys/fs/cgroup/.../cgroup.events，测试替换不扩大生产读取权限。 */
    readFile?(file: string): Promise<string>;
    now?(): number;
    sleep?(milliseconds: number): Promise<void>;
    stopTimeoutMs?: number;
}
function unavailable(): never {
    throw new Error("无法安全确认 systemd 服务状态");
}

async function readCgroupEvents(file: string): Promise<string> {
    // 禁止祖先符号链接绕过固定内核目录；不读取进程提供的任意文件。
    if ((await realpath(file)) !== file || (await statfs(CGROUP_ROOT)).type !== 0x63677270)
        unavailable();
    const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        const stat = await handle.stat();
        if (!stat.isFile()) unavailable();
        const bytes = Buffer.alloc(4097);
        const result = await handle.read(bytes, 0, bytes.length, 0);
        if (result.bytesRead > 4096) unavailable();
        return bytes.subarray(0, result.bytesRead).toString("utf8");
    } finally {
        await handle.close();
    }
}

function parse(output: string): Properties {
    if (output.length > 16384 || /[\u0000\r]/.test(output)) unavailable();
    const result: Partial<Properties> = {};
    for (const line of output.split("\n")) {
        if (!line) continue;
        const separator = line.indexOf("=");
        const key = line.slice(0, separator) as (typeof PROPERTIES)[number];
        if (separator < 1 || !PROPERTIES.includes(key) || Object.hasOwn(result, key)) unavailable();
        result[key] = line.slice(separator + 1);
    }
    if (PROPERTIES.some(key => !Object.hasOwn(result, key))) unavailable();
    return result as Properties;
}
function pid(value: string): number {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) unavailable();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > 2147483647) unavailable();
    return number;
}
function cgroupFile(group: string): string {
    if (
        !group.startsWith("/") ||
        group === "/" ||
        /[\u0000-\u001f\u007f\\]/.test(group) ||
        group
            .split("/")
            .slice(1)
            .some(part => !part || part === "." || part === "..") ||
        path.posix.basename(group) !== UNIT
    )
        unavailable();
    return `${CGROUP_ROOT}${group}/cgroup.events`;
}
function populated(text: string): boolean {
    if (text.length > 4096) unavailable();
    const values = new Map<string, string>();
    for (const line of text.trim().split("\n")) {
        const match = /^([a-z_]+) ([0-9]+)$/.exec(line);
        if (!match || values.has(match[1])) unavailable();
        values.set(match[1], match[2]);
    }
    if (!["0", "1"].includes(values.get("populated") ?? "")) unavailable();
    return values.get("populated") === "1";
}

/** 调用者持有服务锁；这里既不写定义，也不尝试用未知状态恢复服务。 */
export class SystemdServicePlatform implements ServicePlatform {
    private readonly readFile: (file: string) => Promise<string>;
    private readonly now: () => number;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private readonly timeout: number;
    constructor(
        private readonly host: ServiceHost,
        private readonly scope: ServiceScope,
        private readonly expectedDefinitionPath: string,
        options: SystemdServicePlatformOptions = {},
    ) {
        if (
            host.platform !== "linux" ||
            !["user", "system"].includes(scope) ||
            !path.posix.isAbsolute(expectedDefinitionPath) ||
            /[\u0000-\u001f\u007f]/.test(expectedDefinitionPath) ||
            path.posix.normalize(expectedDefinitionPath) !== expectedDefinitionPath ||
            path.posix.basename(expectedDefinitionPath) !== UNIT
        )
            unavailable();
        this.timeout = options.stopTimeoutMs ?? 120_000;
        if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 300_000)
            unavailable();
        this.readFile = options.readFile ?? readCgroupEvents;
        this.now = options.now ?? Date.now;
        this.sleep =
            options.sleep ??
            (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    }
    private command(args: string[], deadline?: number): string {
        const remaining = deadline === undefined ? 5000 : Math.min(5000, deadline - this.now());
        if (remaining <= 0) throw new Error("systemd 服务停止超时，尚未确认子进程全部退出");
        try {
            return this.host.exec(
                "systemctl",
                [
                    "--no-pager",
                    "--no-ask-password",
                    ...(this.scope === "user" ? ["--user"] : []),
                    ...args,
                ],
                { timeoutMs: remaining },
            );
        } catch {
            unavailable();
        }
    }
    private show(deadline?: number): Properties {
        return parse(
            this.command(["show", `--property=${PROPERTIES.join(",")}`, "--", UNIT], deadline),
        );
    }
    async inspect(): Promise<ServicePlatformState> {
        return this.inspectWithin();
    }
    private async inspectWithin(deadline?: number): Promise<ServicePlatformState> {
        try {
            const properties = this.show(deadline);
            const main = pid(properties.MainPID),
                control = pid(properties.ControlPID);
            const pairs: Record<string, readonly string[]> = {
                active: ["running", "exited"],
                inactive: ["dead"],
                failed: ["failed"],
                activating: [
                    "start-pre",
                    "start",
                    "start-post",
                    "auto-restart",
                    "auto-restart-queued",
                ],
                deactivating: [
                    "stop",
                    "stop-watchdog",
                    "stop-sigterm",
                    "stop-sigkill",
                    "stop-post",
                    "final-watchdog",
                    "final-sigterm",
                    "final-sigkill",
                ],
                reloading: ["reload", "reload-signal", "reload-notify"],
            };
            if (!pairs[properties.ActiveState]?.includes(properties.SubState)) unavailable();
            const loaded = properties.LoadState === "loaded";
            if (!loaded && properties.LoadState !== "not-found") unavailable();
            const running = !["inactive", "failed"].includes(properties.ActiveState);
            if (
                loaded
                    ? properties.FragmentPath !== this.expectedDefinitionPath
                    : properties.FragmentPath !== "" ||
                      properties.UnitFileState !== "" ||
                      running ||
                      main ||
                      control ||
                      properties.ControlGroup ||
                      properties.InvocationID
            )
                unavailable();
            if (loaded && !["enabled", "disabled"].includes(properties.UnitFileState))
                unavailable();
            const identity = properties.InvocationID || null;
            if (identity && (!/^[0-9a-f]{32}$/.test(identity) || /^0+$/.test(identity)))
                unavailable();
            if ((running || main || control) && !identity) unavailable();
            let empty = false;
            if (properties.ControlGroup) {
                empty = !populated(await this.readFile(cgroupFile(properties.ControlGroup)));
                // 读取内核证据期间发生换代不能把两个实例的观察拼成一份证明。
                const after = this.show(deadline);
                if (PROPERTIES.some(key => properties[key] !== after[key])) unavailable();
            } else if (properties.ActiveState === "inactive" && !main && !control) {
                empty = true;
            }
            return {
                state:
                    properties.ActiveState === "active" && properties.SubState === "running"
                        ? "running"
                        : properties.ActiveState === "inactive" && properties.SubState === "dead"
                          ? "stopped"
                          : properties.ActiveState === "failed"
                            ? "failed"
                            : "transitioning",
                running,
                enabled: properties.UnitFileState === "enabled",
                loaded,
                definitionPath: this.expectedDefinitionPath,
                processId: main || null,
                identity,
                quiescent: !running && !main && !control && empty,
            };
        } catch {
            unavailable();
        }
    }
    async quiesce(): Promise<void> {
        const deadline = this.now() + this.timeout;
        const before = await this.inspectWithin(deadline);
        if (!before.loaded) {
            if (!before.quiescent) unavailable();
            return;
        }
        this.command(["disable", "--", UNIT], deadline);
        this.command(["stop", "--no-block", "--", UNIT], deadline);
        for (;;) {
            const current = await this.inspectWithin(deadline);
            if (current.enabled || (current.running && current.identity !== before.identity))
                unavailable();
            if (current.quiescent) return;
            if (this.now() >= deadline)
                throw new Error("systemd 服务停止超时，尚未确认子进程全部退出");
            await this.sleep(Math.min(100, deadline - this.now()));
        }
    }
    async reload(enabled: boolean): Promise<void> {
        if (typeof enabled !== "boolean") unavailable();
        this.command(["daemon-reload"]);
        this.command([enabled ? "enable" : "disable", "--", UNIT]);
        const current = await this.inspect();
        if (!current.loaded || current.enabled !== enabled) unavailable();
    }
    async start(): Promise<void> {
        const current = await this.inspect();
        if (!current.loaded || (!current.running && !current.quiescent)) unavailable();
        if (!current.running) this.command(["start", "--no-block", "--", UNIT]);
    }
}
