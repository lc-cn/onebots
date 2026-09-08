import { isLaunchdServiceMissing } from "./service-platform-presence.js";
import path from "node:path";
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
    private group(pid: number, deadline?: number): number | null {
        const output = this.exec("/bin/ps", ["-o", "pid=,pgid=", "-p", String(pid)], deadline);
        const match = /^\s*([1-9][0-9]*)\s+([1-9][0-9]*)\s*$/.exec(output);
        if (!match || Number(match[1]) !== pid) unavailable();
        return Number(match[2]) === pid && pid > 1 ? pid : null;
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
            const group = pid === null ? null : this.group(pid, deadline);
            if (group) this.groups.add(group);
            if (pid !== null && !group) this.unprovenGroup = true;
            // ps 观察期间服务换代或状态变化，拒绝拼接两份不同实例的证据。
            const after = this.loaded(deadline);
            if (
                !after ||
                ["path", "state", "pid", "last exit code"].some(
                    key => after.get(key) !== data.get(key),
                )
            )
                unavailable();
            return {
                state: observedState,
                running: pid !== null,
                enabled,
                loaded: true,
                definitionPath: this.expectedDefinitionPath,
                processId: pid,
                identity: group ? `${this.target}:pgid:${group}` : null,
                quiescent: observedState === "stopped" && pid === null && this.groupsGone(),
            };
        } catch {
            unavailable();
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
    async reload(enabled: boolean): Promise<void> {
        try {
            if (typeof enabled !== "boolean") unavailable();
            this.command([enabled ? "enable" : "disable", this.target]);
            if ((await this.inspect()).enabled !== enabled) unavailable();
        } catch {
            unavailable();
        }
    }
    async start(): Promise<void> {
        try {
            const deadline = this.now() + this.timeout;
            const before = await this.inspectWithin(deadline);
            if (before.running) {
                if (!before.identity) unavailable();
                return;
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
            for (;;) {
                const current = await this.inspectWithin(deadline);
                if (!current.enabled || !current.loaded) unavailable();
                if (current.running) {
                    if (!current.identity) unavailable();
                    if (!before.enabled) {
                        this.command(["disable", this.target], deadline);
                        const restored = await this.inspectWithin(deadline);
                        if (
                            restored.enabled ||
                            !restored.running ||
                            !restored.loaded ||
                            restored.identity !== current.identity ||
                            restored.processId !== current.processId
                        )
                            unavailable();
                    }
                    return;
                }
                if (this.now() >= deadline) unavailable();
                await this.sleep(Math.min(100, deadline - this.now()));
            }
        } catch {
            unavailable();
        }
    }
}
