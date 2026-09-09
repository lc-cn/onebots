import { isLaunchdServiceMissing } from "./service-platform-presence.js";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { LAUNCHD_LABEL, type ServiceScope } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";

export interface LaunchdServicePlatformOptions {
    /** 仅上层持锁确认从未启动的新定义可提供；不能从 print 的缺失推断。 */
    freshDefinition?: boolean;
    /** 只能进行 signal 0 存活探测；注入边界供无宿主服务的测试使用。 */
    processExists?(pid: number): boolean;
    /** 新管理工作区的持久所有权证明；仅OS明确unloaded且已知进程组全退出时调用。 */
    confirmUnloadedProcesses?(): Promise<boolean>;
    now?(): number;
    sleep?(milliseconds: number): Promise<void>;
    stopTimeoutMs?: number;
}
function unavailable(): never {
    throw new Error("无法安全确认 launchd 服务及其进程组状态");
}
function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        return unavailable();
    }
}
function fields(output: string, target: string): Map<string, string> {
    if (output.length > 262144 || /[\u0000\r]/.test(output)) unavailable();
    const lines = output.trimEnd().split("\n");
    if (lines.shift() !== `${target} = {` || lines.pop() !== "}") unavailable();
    const result = new Map<string, string>();
    // launchctl print 的嵌套环境/端点不能伪装成顶层状态。
    let depth = 1;
    for (const line of lines) {
        const match = /^\s*([a-z ]+) = (.*)$/.exec(line);
        if (depth === 1 && match && ["path", "state", "pid", "last exit code"].includes(match[1])) {
            if (result.has(match[1])) unavailable();
            result.set(match[1], match[2]);
        }
        if (line.trimEnd().endsWith("{")) depth++;
        if (line.trim() === "}") depth--;
        if (depth < 1) unavailable();
    }
    if (depth !== 1) unavailable();
    return result;
}

interface ProcessGeneration {
    group: number;
    started: string;
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

function processGeneration(output: string, expectedPid: number): ProcessGeneration | null {
    if (output.length > 4096 || /[\u0000\r]/.test(output)) unavailable();
    const match =
        /^\s*([1-9][0-9]*)\s+([1-9][0-9]*)\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([1-9]|[12][0-9]|3[01])\s+([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])\s+([0-9]{4})\s*$/.exec(
            output,
        );
    if (!match || Number(match[1]) !== expectedPid) unavailable();
    const group = Number(match[2]);
    if (!Number.isSafeInteger(group) || group > 2147483647) unavailable();
    if (group !== expectedPid || expectedPid <= 1) return null;
    const month = months.indexOf(match[4] as (typeof months)[number]);
    const day = Number(match[5]);
    const year = Number(match[9]);
    const date = new Date(Date.UTC(year, month, day));
    if (
        year < 1970 ||
        year > 9999 ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day ||
        weekdays[date.getUTCDay()] !== match[3]
    )
        unavailable();
    return {
        group,
        started: `${match[9]}${String(month + 1).padStart(2, "0")}${match[5].padStart(2, "0")}T${match[6]}${match[7]}${match[8]}`,
    };
}

/** 仅控制固定 OneBots 身份；不向历史 PID 发停止信号。旧实例缺少独立组证据时拒绝迁移。 */
export class LaunchdServicePlatform implements ServicePlatform {
    private readonly domain: string;
    private readonly target: string;
    private readonly exists: (pid: number) => boolean;
    private readonly now: () => number;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private readonly timeout: number;
    private readonly confirmUnloadedProcesses?: () => Promise<boolean>;
    private readonly groups = new Set<number>();
    private fresh: boolean;
    private unprovenGroup = false;
    constructor(
        private readonly host: ServiceHost,
        scope: ServiceScope,
        private readonly expectedDefinitionPath: string,
        options: LaunchdServicePlatformOptions = {},
    ) {
        if (
            host.platform !== "darwin" ||
            !["user", "system"].includes(scope) ||
            !path.posix.isAbsolute(expectedDefinitionPath) ||
            /[\u0000-\u001f\u007f]/.test(expectedDefinitionPath) ||
            path.posix.normalize(expectedDefinitionPath) !== expectedDefinitionPath ||
            path.posix.basename(expectedDefinitionPath) !== `${LAUNCHD_LABEL}.plist` ||
            (scope === "user" && (!Number.isInteger(host.uid) || host.uid! < 0))
        )
            unavailable();
        this.fresh = options.freshDefinition === true;
        this.domain = scope === "system" ? "system" : `gui/${host.uid}`;
        this.target = `${this.domain}/${LAUNCHD_LABEL}`;
        this.exists = options.processExists ?? processExists;
        this.confirmUnloadedProcesses = options.confirmUnloadedProcesses;
        this.now = options.now ?? Date.now;
        this.sleep =
            options.sleep ??
            (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
        this.timeout = options.stopTimeoutMs ?? 120_000;
        if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 300_000)
            unavailable();
    }
    private exec(file: string, args: string[], deadline?: number): string {
        const timeoutMs = deadline === undefined ? 5000 : Math.min(5000, deadline - this.now());
        if (timeoutMs <= 0) unavailable();
        return this.host.exec(file, args, { timeoutMs });
    }
    private command(args: string[], deadline?: number): string {
        return this.exec("/bin/launchctl", args, deadline);
    }
    private loaded(deadline?: number): Map<string, string> | null {
        let output: string;
        try {
            output = this.command(["print", this.target], deadline);
        } catch (error) {
            if (
                isLaunchdServiceMissing(
                    error,
                    this.domain === "system" ? "system" : "user",
                    this.host.uid,
                )
            )
                return null;
            unavailable();
        }
        return fields(output, this.target);
    }
    private enabled(deadline?: number): boolean {
        const output = this.command(["print-disabled", this.domain], deadline);
        if (
            output.length > 262144 ||
            !/^\s*disabled services = \{\s*\n/.test(output) ||
            !/\n\s*\}\s*$/.test(output)
        )
            unavailable();
        let override: boolean | undefined;
        for (const line of output.trim().split("\n").slice(1, -1)) {
            const match = /^\s*"([^"\r\n]+)" => (enabled|disabled|true|false)\s*$/.exec(line);
            if (!match) unavailable();
            if (match[1] !== LAUNCHD_LABEL) continue;
            if (override !== undefined) unavailable();
            override = match[2] === "enabled" || match[2] === "false";
        }
        // 没有 override 时，plist 的 Disabled 键才是默认值，不能猜测已启用。
        const raw = this.exec(
            "/usr/bin/plutil",
            ["-convert", "json", "-o", "-", this.expectedDefinitionPath],
            deadline,
        );
        if (raw.length > 262144) unavailable();
        const definition: unknown = JSON.parse(raw);
        if (!definition || typeof definition !== "object" || Array.isArray(definition))
            unavailable();
        const value = definition as Record<string, unknown>;
        if (
            value.Label !== LAUNCHD_LABEL ||
            (value.Disabled !== undefined && typeof value.Disabled !== "boolean")
        )
            unavailable();
        return override ?? value.Disabled !== true;
    }
    private generation(pid: number, deadline?: number): ProcessGeneration | null {
        return processGeneration(
            this.exec("/bin/ps", ["-o", "pid=,pgid=,lstart=", "-p", String(pid)], deadline),
            pid,
        );
    }
    private groupsGone(): boolean {
        if (this.unprovenGroup) return false;
        if (!this.groups.size) return this.fresh;
        let gone = true;
        for (const group of this.groups) {
            const leader = this.exists(group),
                members = this.exists(-group);
            if (leader || members) gone = false;
        }
        return gone;
    }
    private async unloadedQuiescent(enabled: boolean, deadline?: number): Promise<boolean> {
        if (this.unprovenGroup || (this.groups.size > 0 && !this.groupsGone())) return false;
        if (this.fresh || !this.confirmUnloadedProcesses) return this.groupsGone();
        if ((await this.confirmUnloadedProcesses()) !== true) return false;
        // 异步持久证据期间若OS加载状态或启用状态变化，不能拼接两个时点的证据。
        if (this.loaded(deadline) !== null || this.enabled(deadline) !== enabled) unavailable();
        return !this.unprovenGroup && (this.groups.size === 0 || this.groupsGone());
    }
    async inspect(): Promise<ServicePlatformState> {
        return this.inspectWithin();
    }
    private async inspectWithin(deadline?: number): Promise<ServicePlatformState> {
        try {
            const enabled = this.enabled(deadline);
            const data = this.loaded(deadline);
            if (!data)
                return {
                    state: "stopped",
                    running: false,
                    enabled,
                    loaded: false,
                    definitionPath: this.expectedDefinitionPath,
                    processId: null,
                    identity: null,
                    quiescent: await this.unloadedQuiescent(enabled, deadline),
                };
            this.fresh = false;
            if (data.get("path") !== this.expectedDefinitionPath) unavailable();
            const state = data.get("state");
            if (
                !["running", "not running", "waiting", "exited", "crashed", "failed"].includes(
                    state ?? "",
                )
            )
                unavailable();
            const exitCode = data.get("last exit code");
            if (
                exitCode !== undefined &&
                (!/^-?(0|[1-9][0-9]*)$/.test(exitCode) || !Number.isSafeInteger(Number(exitCode)))
            )
                unavailable();
            const observedState: ServicePlatformState["state"] =
                state === "running"
                    ? "running"
                    : state === "crashed" ||
                        state === "failed" ||
                        (exitCode !== undefined && Number(exitCode) !== 0)
                      ? "failed"
                      : state === "not running"
                        ? "stopped"
                        : "transitioning";
            const rawPid = data.get("pid");
            const pid = rawPid === undefined ? null : Number(rawPid);
            if (
                rawPid !== undefined &&
                (!/^[1-9][0-9]*$/.test(rawPid) || !Number.isSafeInteger(pid) || pid! > 2147483647)
            )
                unavailable();
            if ((state === "running") !== (pid !== null)) unavailable();
            const generation = pid === null ? null : this.generation(pid, deadline);
            if (generation) this.groups.add(generation.group);
            if (pid !== null && !generation) this.unprovenGroup = true;
            // ps 观察期间服务换代或状态变化，拒绝拼接两份不同实例的证据。
            const after = this.loaded(deadline);
            if (
                !after ||
                ["path", "state", "pid", "last exit code"].some(
                    key => after.get(key) !== data.get(key),
                )
            )
                unavailable();
            const confirmedGeneration = pid === null ? null : this.generation(pid, deadline);
            if (!isDeepStrictEqual(generation, confirmedGeneration)) unavailable();
            return {
                state: observedState,
                running: pid !== null,
                enabled,
                loaded: true,
                definitionPath: this.expectedDefinitionPath,
                processId: pid,
                identity: generation
                    ? `${this.target}:pgid:${generation.group}:started:${generation.started}`
                    : null,
                quiescent: observedState === "stopped" && pid === null && this.groupsGone(),
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
        for (;;) {
            const first = await this.inspectWithin(deadline);
            if (accepts(first)) {
                const second = await this.inspectWithin(deadline);
                if (accepts(second) && isDeepStrictEqual(first, second)) return second;
                unavailable();
            }
            if (this.now() >= deadline) unavailable();
            await this.sleep(Math.min(100, deadline - this.now()));
        }
    }
    async quiesce(): Promise<void> {
        try {
            const deadline = this.now() + this.timeout;
            const before = await this.inspectWithin(deadline);
            if (!["running", "stopped", "failed"].includes(before.state)) unavailable();
            // 冷启动看到已退出但仍 loaded 的 job，并不代表后代全部退出。
            // 可以注销已稳定确认的固定 job，但只有 bootout 后的完整持久证据才能确认停机。
            const coldLoaded =
                before.loaded &&
                !before.running &&
                before.processId === null &&
                !this.unprovenGroup &&
                Boolean(this.confirmUnloadedProcesses);
            if (before.running ? !before.identity : !before.quiescent && !coldLoaded) unavailable();
            this.command(["disable", this.target], deadline);
            const disabled = await this.inspectWithin(deadline);
            if (
                disabled.enabled ||
                disabled.identity !== before.identity ||
                disabled.processId !== before.processId ||
                disabled.state !== before.state ||
                disabled.loaded !== before.loaded
            )
                unavailable();
            if (disabled.loaded) this.command(["bootout", this.target], deadline);
            for (;;) {
                const current = await this.inspectWithin(deadline);
                if (current.enabled || current.loaded || current.running) unavailable();
                if (current.quiescent) return;
                if (this.now() >= deadline) unavailable();
                await this.sleep(Math.min(100, deadline - this.now()));
            }
        } catch {
            unavailable();
        }
    }
    async reload(enabled: boolean): Promise<ServicePlatformState> {
        try {
            if (typeof enabled !== "boolean") unavailable();
            const deadline = this.now() + this.timeout;
            const before = await this.inspectWithin(deadline);
            if (
                before.state !== "stopped" ||
                before.running ||
                before.loaded ||
                !before.quiescent ||
                before.definitionPath !== this.expectedDefinitionPath
            )
                unavailable();
            this.command([enabled ? "enable" : "disable", this.target], deadline);
            return await this.stable(
                deadline,
                state =>
                    state.state === "stopped" &&
                    !state.running &&
                    !state.loaded &&
                    state.quiescent &&
                    state.enabled === enabled &&
                    state.definitionPath === this.expectedDefinitionPath,
            );
        } catch {
            return unavailable();
        }
    }
    async start(): Promise<ServicePlatformState> {
        try {
            const deadline = this.now() + this.timeout;
            const before = await this.inspectWithin(deadline);
            if (before.running) {
                if (!before.identity) unavailable();
                return await this.stable(
                    deadline,
                    state =>
                        state.state === "running" &&
                        state.running &&
                        state.loaded &&
                        state.processId !== null &&
                        state.identity !== null &&
                        state.definitionPath === this.expectedDefinitionPath &&
                        state.enabled === before.enabled &&
                        state.processId === before.processId &&
                        state.identity === before.identity,
                );
            }
            if (before.loaded || !before.quiescent) unavailable();
            // launchctl(1): disabled服务不能加载。上层starting-manager意图必须先持久化；
            // 临时enable也属于该外部效果，失败不在这里盲重试或假装恢复原状态。
            if (!before.enabled) {
                this.command(["enable", this.target], deadline);
                const enabled = await this.inspectWithin(deadline);
                if (!enabled.enabled || enabled.loaded || !enabled.quiescent) unavailable();
            }
            this.fresh = false;
            this.command(["bootstrap", this.domain, this.expectedDefinitionPath], deadline);
            const started = await this.stableInstance(
                deadline,
                state =>
                    state.state === "running" &&
                    state.running &&
                    state.loaded &&
                    state.enabled &&
                    state.processId !== null &&
                    state.identity !== null &&
                    state.definitionPath === this.expectedDefinitionPath,
            );
            if (!before.enabled) {
                this.command(["disable", this.target], deadline);
            }
            return await this.stable(
                deadline,
                state =>
                    state.state === "running" &&
                    state.running &&
                    state.loaded &&
                    state.enabled === before.enabled &&
                    state.processId === started.processId &&
                    state.identity === started.identity &&
                    state.definitionPath === this.expectedDefinitionPath,
            );
        } catch {
            return unavailable();
        }
    }
}
