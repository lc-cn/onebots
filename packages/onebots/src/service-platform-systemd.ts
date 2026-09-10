import { constants } from "node:fs";
import { open, realpath, statfs } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { MANAGER_SERVICE_STOP_TIMEOUT_SECONDS } from "./manager-service-definition.js";
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
    /** 优雅停止超期后，对已验证固定 unit 的 cgroup 执行一次兜底强制终止。 */
    forceKillAfterMs?: number;
    /** 仅用于测试替换；生产实现持有已验证 cgroup v2 的 cgroup.kill 文件句柄。 */
    openCgroupKill?(file: string): Promise<CgroupKillHandle>;
}
interface CgroupKillHandle {
    kill(): Promise<void>;
    close(): Promise<void>;
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

async function openCgroupKill(file: string): Promise<CgroupKillHandle> {
    if ((await realpath(file)) !== file || (await statfs(CGROUP_ROOT)).type !== 0x63677270)
        unavailable();
    const handle = await open(
        file,
        constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        const stat = await handle.stat();
        if (!stat.isFile()) unavailable();
    } catch (error) {
        await handle.close();
        throw error;
    }
    return {
        kill: async () => {
            const result = await handle.write("1");
            if (result.bytesWritten !== 1) unavailable();
        },
        close: async () => handle.close(),
    };
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
function cgroupKillFile(group: string): string {
    cgroupFile(group);
    return `${CGROUP_ROOT}${group}/cgroup.kill`;
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
    private readonly openCgroupKill: (file: string) => Promise<CgroupKillHandle>;
    private readonly now: () => number;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private readonly timeout: number;
    private readonly forceKillAfter: number;
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
        this.forceKillAfter =
            options.forceKillAfterMs ?? MANAGER_SERVICE_STOP_TIMEOUT_SECONDS * 1000 + 5_000;
        if (
            !Number.isInteger(this.forceKillAfter) ||
            this.forceKillAfter < 1 ||
            this.forceKillAfter >= this.timeout
        )
            unavailable();
        this.readFile = options.readFile ?? readCgroupEvents;
        this.openCgroupKill = options.openCgroupKill ?? openCgroupKill;
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
        const detailed = await this.inspectDetailedWithin(deadline);
        return {
            state: detailed.state,
            running: detailed.running,
            enabled: detailed.enabled,
            loaded: detailed.loaded,
            definitionPath: detailed.definitionPath,
            processId: detailed.processId,
            identity: detailed.identity,
            quiescent: detailed.quiescent,
        };
    }
    private async inspectDetailedWithin(
        deadline?: number,
    ): Promise<ServicePlatformState & { controlGroup: string | null }> {
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
                controlGroup: properties.ControlGroup || null,
            };
        } catch {
            unavailable();
        }
    }
    private async stable(
        deadline: number,
        accepts: (state: ServicePlatformState) => boolean,
    ): Promise<ServicePlatformState> {
        for (;;) {
            const first = await this.inspectWithin(deadline);
            if (accepts(first)) {
                const second = await this.inspectWithin(deadline);
                if (accepts(second) && isDeepStrictEqual(first, second)) return second;
            }
            if (this.now() >= deadline) unavailable();
            await this.sleep(Math.min(100, deadline - this.now()));
        }
    }
    private async stableInstance(
        deadline: number,
        accepts: (state: ServicePlatformState) => boolean,
    ): Promise<ServicePlatformState> {
        let generation: { processId: number | null; identity: string } | null = null;
        const bindGeneration = (state: ServicePlatformState) => {
            if (state.identity !== null) {
                if (!generation) {
                    generation = { processId: state.processId, identity: state.identity };
                    return;
                }
                if (state.identity !== generation.identity) unavailable();
                if (generation.processId === null) generation.processId = state.processId;
                else if (state.processId !== generation.processId) unavailable();
                return;
            }
            if (generation) unavailable();
        };
        for (;;) {
            const first = await this.inspectWithin(deadline);
            bindGeneration(first);
            if (accepts(first)) {
                const second = await this.inspectWithin(deadline);
                bindGeneration(second);
                if (accepts(second) && isDeepStrictEqual(first, second)) return second;
                unavailable();
            }
            if (this.now() >= deadline) unavailable();
            await this.sleep(Math.min(100, deadline - this.now()));
        }
    }
    async quiesce(): Promise<void> {
        const startedAt = this.now();
        const deadline = startedAt + this.timeout;
        const forceAt = startedAt + this.forceKillAfter;
        const before = await this.inspectDetailedWithin(deadline);
        if (!before.loaded) {
            if (!before.quiescent) unavailable();
            return;
        }
        // 显式恢复可在上一次 disable/stop 的响应丢失后再次进入。inspectWithin 已用完整
        // systemd 状态与 cgroup 证据证明固定 unit 静止且禁用时，只读接受目标，不重派命令。
        if (!before.enabled && before.quiescent) return;
        this.command(["disable", "--", UNIT], deadline);
        this.command(["stop", "--no-block", "--", UNIT], deadline);
        let forced = false;
        for (;;) {
            const current = await this.inspectDetailedWithin(deadline);
            // disable/stop 针对固定 unit；故障候选可能在两个命令之间被 systemd 自动换代。
            // inspectDetailedWithin 仍逐次核验精确定义路径与 cgroup，调用方也持服务锁并核验文件，
            // 因此不能把同一 unit 的新 InvocationID 误判成外部替换而放弃静止。
            if (current.enabled) unavailable();
            if (current.quiescent) return;
            if (this.now() >= deadline)
                throw new Error("systemd 服务停止超时，尚未确认子进程全部退出");
            if (!forced && this.now() >= forceAt) {
                // systemd 自身应在 TimeoutStopSec 后清理整个 cgroup；若 stop job 与故障候选
                // 自动换代竞态导致子进程仍存活，显式回退可以在优雅窗口后兜底终止该固定
                // unit。先重申人工 stop，确保强制终止不会被 Restart=on-failure 当作新故障
                // 再次拉起；随后再次核验实例身份和 ControlGroup，只写已绑定 cgroup v2
                // 的 cgroup.kill，避免同名 unit 换代时误杀新实例。写入结果仍不是完成证明。
                if (!current.identity || !current.controlGroup) unavailable();
                this.command(["stop", "--no-block", "--", UNIT], deadline);
                const target = await this.inspectDetailedWithin(deadline);
                if (target.quiescent) return;
                if (
                    target.enabled ||
                    target.identity !== current.identity ||
                    target.controlGroup !== current.controlGroup
                )
                    unavailable();
                let handle: CgroupKillHandle | undefined;
                try {
                    handle = await this.openCgroupKill(cgroupKillFile(target.controlGroup));
                    // 路径校验与 open 之间旧 cgroup 仍可能消失并被同名新实例复用；持有文件
                    // 描述符后再核验一次，确保即将写入的内核对象仍属于目标实例。
                    const bound = await this.inspectDetailedWithin(deadline);
                    if (bound.quiescent) return;
                    if (
                        bound.enabled ||
                        bound.identity !== target.identity ||
                        bound.controlGroup !== target.controlGroup
                    )
                        unavailable();
                    await handle.kill();
                } catch {
                    // 权限不足、cgroup 消失、短写或换代均不得降级回按 unit 名终止。
                    unavailable();
                } finally {
                    if (handle)
                        try {
                            await handle.close();
                        } catch {
                            unavailable();
                        }
                }
                const after = await this.inspectDetailedWithin(deadline);
                if (
                    !after.quiescent &&
                    (after.identity !== target.identity ||
                        after.controlGroup !== target.controlGroup)
                )
                    unavailable();
                forced = true;
                continue;
            }
            await this.sleep(Math.min(100, deadline - this.now()));
        }
    }
    async reload(enabled: boolean): Promise<ServicePlatformState> {
        if (typeof enabled !== "boolean") unavailable();
        const deadline = this.now() + this.timeout;
        const before = await this.inspectWithin(deadline);
        if (before.state !== "stopped" || before.running || !before.quiescent) unavailable();
        this.command(["daemon-reload"], deadline);
        this.command([enabled ? "enable" : "disable", "--", UNIT], deadline);
        return this.stable(
            deadline,
            state =>
                state.state === "stopped" &&
                !state.running &&
                state.quiescent &&
                state.enabled === enabled &&
                state.loaded &&
                state.definitionPath === this.expectedDefinitionPath,
        );
    }
    async start(expectedInitialState?: ServicePlatformState): Promise<ServicePlatformState> {
        const deadline = this.now() + this.timeout;
        const current = await this.inspectWithin(deadline);
        if (expectedInitialState && !isDeepStrictEqual(current, expectedInitialState))
            unavailable();
        if (!current.loaded || (!current.running && !current.quiescent)) unavailable();
        const enabled = current.enabled;
        if (!current.running) this.command(["start", "--no-block", "--", UNIT], deadline);
        const stable = current.running ? this.stable.bind(this) : this.stableInstance.bind(this);
        return stable(
            deadline,
            state =>
                state.state === "running" &&
                state.running &&
                state.loaded &&
                state.processId !== null &&
                state.identity !== null &&
                state.definitionPath === this.expectedDefinitionPath &&
                state.enabled === enabled &&
                (!current.running ||
                    (state.processId === current.processId && state.identity === current.identity)),
        );
    }
}
