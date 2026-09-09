import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { SERVICE_NAME, type ServiceScope } from "./service-definition.js";
import { buildManagerServiceArgs, parseManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";

export interface WindowsServiceDefinition {
    schemaVersion: 1;
    serviceName: typeof SERVICE_NAME;
    hostExecutable: string;
    managerExecutable: string;
    managerArguments: string[];
    workingDirectory: string;
    pipeName: string;
}

interface WindowsScmState {
    Name: string;
    State: "Running" | "Stopped" | "Start Pending" | "Stop Pending";
    StartMode: "Auto" | "Manual" | "Disabled";
    ProcessId: number;
    PathName: string;
}

export interface WindowsNativeStatus {
    version: 1;
    requestId: string;
    ok: true;
    state: {
        service: "starting" | "running" | "stopping" | "stopped" | "failed";
        manager: { state: "running" | "stopping" | "stopped" | "exited"; pid?: number };
        startedAt: string;
        control?: {
            manager: { id: string; version: string; pid: number };
            gateway: {
                desired: "running" | "stopped";
                actual: "starting" | "running" | "stopping" | "stopped" | "failed";
            };
        };
    };
}

const PIPE_NAME = `\\\\.\\pipe\\${SERVICE_NAME}-control`;
const POWERSHELL_QUERY =
    `$service=Get-CimInstance Win32_Service -Filter \"Name='${SERVICE_NAME}'\";` +
    "if($null -ne $service){$service|Select-Object Name,State,StartMode,ProcessId,PathName|ConvertTo-Json -Compress}";

function unavailable(): never {
    throw new Error("无法安全确认 Windows SCM 管理服务状态");
}

function plainObject(value: unknown): value is Record<string, unknown> {
    return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value))
    );
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
    const keys = Reflect.ownKeys(value);
    return (
        keys.length === expected.length &&
        keys.every(key => typeof key === "string" && expected.includes(key))
    );
}

function singleJsonLine(output: string, limit: number): string {
    if (output.length > limit || output.includes("\u0000")) unavailable();
    const value = output.endsWith("\r\n")
        ? output.slice(0, -2)
        : output.endsWith("\n")
          ? output.slice(0, -1)
          : output;
    if (!value || /[\r\n]/.test(value)) unavailable();
    return value;
}

function parseScmState(output: string): WindowsScmState | null {
    if (!output.trim()) return null;
    const text = singleJsonLine(output, 16_384);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        unavailable();
    }
    if (
        !plainObject(value) ||
        !exactKeys(value, ["Name", "State", "StartMode", "ProcessId", "PathName"])
    )
        unavailable();
    if (
        value.Name !== SERVICE_NAME ||
        !["Running", "Stopped", "Start Pending", "Stop Pending"].includes(String(value.State)) ||
        !["Auto", "Manual", "Disabled"].includes(String(value.StartMode)) ||
        typeof value.ProcessId !== "number" ||
        !Number.isSafeInteger(value.ProcessId) ||
        value.ProcessId < 0 ||
        value.ProcessId > 0xffffffff ||
        typeof value.PathName !== "string" ||
        !value.PathName
    )
        unavailable();
    return value as unknown as WindowsScmState;
}

function parseDefinitionBytes(bytes: Buffer): WindowsServiceDefinition {
    let value: unknown;
    try {
        if (bytes.length < 2 || bytes.length > 65_536 || bytes.includes(0)) unavailable();
        value = JSON.parse(bytes.toString("utf8"));
    } catch {
        unavailable();
    }
    const keys = [
        "schemaVersion",
        "serviceName",
        "hostExecutable",
        "managerExecutable",
        "managerArguments",
        "workingDirectory",
        "pipeName",
    ];
    if (!plainObject(value) || !exactKeys(value, keys)) unavailable();
    if (
        value.schemaVersion !== 1 ||
        value.serviceName !== SERVICE_NAME ||
        value.pipeName !== PIPE_NAME ||
        ![value.hostExecutable, value.managerExecutable, value.workingDirectory].every(
            item =>
                typeof item === "string" &&
                path.win32.isAbsolute(item) &&
                !/[\u0000\r\n]/.test(item),
        ) ||
        !Array.isArray(value.managerArguments) ||
        value.managerArguments.some(item => typeof item !== "string" || /[\u0000\r\n]/.test(item))
    )
        unavailable();
    return value as unknown as WindowsServiceDefinition;
}

function readDefinition(file: string): WindowsServiceDefinition {
    try {
        return parseDefinitionBytes(new ConfigurationFile(file).readRaw().bytes);
    } catch {
        unavailable();
    }
}

function quoteWindows(value: string): string {
    if (!/[\s"]/u.test(value)) return value;
    return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

function serviceCommand(definition: WindowsServiceDefinition, controlSid: string): string {
    const args = [
        definition.hostExecutable,
        "service-run",
        "--service-name",
        definition.serviceName,
        "--manager",
        definition.managerExecutable,
        ...definition.managerArguments.flatMap(argument => ["--manager-arg", argument]),
        "--working-dir",
        definition.workingDirectory,
        "--pipe",
        definition.pipeName,
        "--control-sid",
        controlSid,
    ];
    return args.map(quoteWindows).join(" ");
}

export function parseWindowsNativeStatus(output: string): WindowsNativeStatus {
    const text = singleJsonLine(output, 65_536);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        unavailable();
    }
    if (!plainObject(value) || !exactKeys(value, ["version", "requestId", "ok", "state"]))
        unavailable();
    if (
        value.version !== 1 ||
        value.ok !== true ||
        typeof value.requestId !== "string" ||
        !/^[A-Za-z0-9._:-]{1,64}$/.test(value.requestId)
    )
        unavailable();
    const state = value.state;
    if (
        !plainObject(state) ||
        !exactKeys(
            state,
            state.control === undefined
                ? ["service", "manager", "startedAt"]
                : ["service", "manager", "startedAt", "control"],
        )
    )
        unavailable();
    const manager = state.manager;
    if (
        !plainObject(manager) ||
        !exactKeys(manager, manager.pid === undefined ? ["state"] : ["state", "pid"])
    )
        unavailable();
    if (
        !["starting", "running", "stopping", "stopped", "failed"].includes(String(state.service)) ||
        !["running", "stopping", "stopped", "exited"].includes(String(manager.state)) ||
        typeof state.startedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(state.startedAt) ||
        !Number.isFinite(Date.parse(state.startedAt)) ||
        manager.state !== "running" ||
        typeof manager.pid !== "number" ||
        !Number.isSafeInteger(manager.pid) ||
        manager.pid < 1 ||
        manager.pid > 0xffffffff
    )
        unavailable();
    if (state.control !== undefined) {
        const control = state.control;
        if (!plainObject(control) || !exactKeys(control, ["manager", "gateway"])) unavailable();
        const controlManager = control.manager;
        const gateway = control.gateway;
        if (
            !plainObject(controlManager) ||
            !exactKeys(controlManager, ["id", "version", "pid"]) ||
            typeof controlManager.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                controlManager.id,
            ) ||
            typeof controlManager.version !== "string" ||
            controlManager.version.length > 128 ||
            !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
                controlManager.version,
            ) ||
            controlManager.pid !== manager.pid ||
            !plainObject(gateway) ||
            !exactKeys(gateway, ["desired", "actual"]) ||
            !["running", "stopped"].includes(String(gateway.desired)) ||
            !["starting", "running", "stopping", "stopped", "failed"].includes(
                String(gateway.actual),
            )
        )
            unavailable();
    }
    return value as unknown as WindowsNativeStatus;
}

export function renderWindowsManagerServiceDefinition(input: unknown): string {
    const spec = parseManagerServiceSpec(input);
    if (process.arch !== "x64" && process.arch !== "arm64")
        throw new Error("当前 Windows 架构尚无管理服务宿主");
    const hostExecutable = path.win32.join(
        path.win32.dirname(spec.binPath),
        "native",
        `win32-${process.arch}`,
        "onebots-windows-host.exe",
    );
    return (
        JSON.stringify(
            {
                schemaVersion: 1,
                serviceName: SERVICE_NAME,
                hostExecutable,
                managerExecutable: spec.nodePath,
                managerArguments: buildManagerServiceArgs(spec),
                workingDirectory: spec.workingDirectory,
                pipeName: PIPE_NAME,
            } satisfies WindowsServiceDefinition,
            null,
            2,
        ) + "\n"
    );
}

export interface WindowsServicePlatformOptions {
    now?(): number;
    sleep?(milliseconds: number): Promise<void>;
    timeoutMs?: number;
    /** 测试边界；生产始终从受身份校验的定义文件读取。 */
    definition?: WindowsServiceDefinition;
    hostExecutableExists?(file: string): boolean;
}

/** Windows SCM系统服务驱动；真实生命周期仍须由Windows验收作业证明。 */
export class WindowsServicePlatform implements ServicePlatform {
    private readonly now: () => number;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private readonly timeout: number;
    private readonly definition: () => WindowsServiceDefinition;
    private readonly hostExecutableExists: (file: string) => boolean;
    constructor(
        private readonly host: ServiceHost,
        scope: ServiceScope,
        private readonly expectedDefinitionPath: string,
        options: WindowsServicePlatformOptions = {},
    ) {
        if (
            host.platform !== "win32" ||
            scope !== "system" ||
            host.isElevated !== true ||
            typeof host.windowsSid !== "string" ||
            !/^S-1-(?:[0-9]+-)+[0-9]+$/.test(host.windowsSid) ||
            !path.win32.isAbsolute(expectedDefinitionPath)
        )
            unavailable();
        this.now = options.now ?? Date.now;
        this.sleep =
            options.sleep ??
            (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
        this.timeout = options.timeoutMs ?? 120_000;
        this.definition = options.definition
            ? () => structuredClone(options.definition!)
            : () => readDefinition(this.expectedDefinitionPath);
        this.hostExecutableExists =
            options.hostExecutableExists ?? (file => fs.statSync(file).isFile());
        if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 300_000)
            unavailable();
    }
    private scm(): WindowsScmState | null {
        return parseScmState(
            this.host.exec(
                "powershell.exe",
                ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_QUERY],
                { timeoutMs: 5000 },
            ),
        );
    }
    async inspect(): Promise<ServicePlatformState> {
        const scm = this.scm();
        if (!scm)
            return {
                state: "stopped",
                running: false,
                enabled: false,
                loaded: false,
                definitionPath: this.expectedDefinitionPath,
                processId: null,
                identity: null,
                quiescent: true,
            };
        const definition = this.definition();
        if (scm.PathName !== serviceCommand(definition, this.host.windowsSid!)) unavailable();
        const running = scm.State !== "Stopped";
        let identity: string | null = null;
        let managerPid: number | null = null;
        if (scm.State === "Running" && scm.ProcessId > 0) {
            try {
                const status = parseWindowsNativeStatus(
                    this.host.exec(
                        definition.hostExecutable,
                        ["status", "--pipe", definition.pipeName, "--timeout", "5s"],
                        { timeoutMs: 6000 },
                    ),
                );
                managerPid = status.state.manager.pid!;
                identity = `${status.state.startedAt}/host:${scm.ProcessId}/manager:${managerPid}`;
            } catch {
                // SCM已运行但宿主管道尚未就绪时只能报告转换态，不能拼出实例身份。
            }
        }
        return {
            state:
                scm.State === "Running" && identity
                    ? "running"
                    : scm.State === "Stopped"
                      ? "stopped"
                      : "transitioning",
            running,
            enabled: scm.StartMode === "Auto",
            loaded: true,
            definitionPath: this.expectedDefinitionPath,
            processId: (managerPid ?? scm.ProcessId) || null,
            identity,
            quiescent: scm.State === "Stopped" && scm.ProcessId === 0,
        };
    }
    private async stable(
        accepts: (state: ServicePlatformState) => boolean,
    ): Promise<ServicePlatformState> {
        const deadline = this.now() + this.timeout;
        for (;;) {
            const first = await this.inspect();
            if (accepts(first)) {
                const second = await this.inspect();
                if (accepts(second) && isDeepStrictEqual(first, second)) return second;
            }
            if (this.now() >= deadline) unavailable();
            await this.sleep(Math.min(100, deadline - this.now()));
        }
    }
    async quiesce(): Promise<void> {
        const before = await this.inspect();
        if (!before.loaded) return;
        this.host.exec("sc.exe", ["config", SERVICE_NAME, "start=", "disabled"], {
            timeoutMs: 5000,
        });
        if (before.running) this.host.exec("sc.exe", ["stop", SERVICE_NAME], { timeoutMs: 5000 });
        await this.stable(
            state => state.loaded && state.state === "stopped" && !state.enabled && state.quiescent,
        );
    }
    async reload(enabled: boolean): Promise<ServicePlatformState> {
        const definition = this.definition();
        try {
            if (!this.hostExecutableExists(definition.hostExecutable)) unavailable();
        } catch {
            unavailable();
        }
        const command = serviceCommand(definition, this.host.windowsSid!);
        const before = await this.inspect();
        this.host.exec(
            "sc.exe",
            before.loaded
                ? [
                      "config",
                      SERVICE_NAME,
                      "binPath=",
                      command,
                      "start=",
                      enabled ? "auto" : "demand",
                  ]
                : [
                      "create",
                      SERVICE_NAME,
                      "binPath=",
                      command,
                      "start=",
                      enabled ? "auto" : "demand",
                      "DisplayName=",
                      "OneBots Control Service",
                  ],
            { timeoutMs: 5000 },
        );
        return this.stable(
            state => state.loaded && state.enabled === enabled && state.state === "stopped",
        );
    }
    /**
     * 服务定义文件事务已经从previousDefinition切到当前字节后使用。
     * 只有SCM仍精确绑定旧命令且处于稳定停态时才允许改写，避免同名服务或并发升级被接管。
     */
    async reloadReplacing(
        previousDefinition: Buffer,
        enabled: boolean,
    ): Promise<ServicePlatformState> {
        if (!Buffer.isBuffer(previousDefinition) || typeof enabled !== "boolean") unavailable();
        const previous = parseDefinitionBytes(previousDefinition);
        const current = this.definition();
        try {
            if (!this.hostExecutableExists(current.hostExecutable)) unavailable();
        } catch {
            unavailable();
        }
        const scm = this.scm();
        if (
            !scm ||
            scm.State !== "Stopped" ||
            scm.ProcessId !== 0 ||
            scm.PathName !== serviceCommand(previous, this.host.windowsSid!)
        )
            unavailable();
        this.host.exec(
            "sc.exe",
            [
                "config",
                SERVICE_NAME,
                "binPath=",
                serviceCommand(current, this.host.windowsSid!),
                "start=",
                enabled ? "auto" : "demand",
            ],
            { timeoutMs: 5000 },
        );
        return this.stable(
            state => state.loaded && state.enabled === enabled && state.state === "stopped",
        );
    }
    async start(expectedInitialState?: ServicePlatformState): Promise<ServicePlatformState> {
        const initial = await this.inspect();
        if (expectedInitialState && !isDeepStrictEqual(initial, expectedInitialState))
            unavailable();
        if (!initial.loaded || !initial.quiescent) unavailable();
        this.host.exec("sc.exe", ["start", SERVICE_NAME], { timeoutMs: 5000 });
        return this.stable(state => state.state === "running" && state.identity !== null);
    }
}

/** 定义文件已由卸载事务移除、进程树已确认退出后调用；只注销固定SCM身份。 */
export function unregisterWindowsManagerService(
    host: ServiceHost,
    definition: WindowsServiceDefinition,
): void {
    if (
        host.platform !== "win32" ||
        host.isElevated !== true ||
        typeof host.windowsSid !== "string" ||
        !/^S-1-(?:[0-9]+-)+[0-9]+$/.test(host.windowsSid)
    )
        unavailable();
    const state = parseScmState(
        host.exec(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_QUERY],
            { timeoutMs: 5000 },
        ),
    );
    if (
        !state ||
        state.State !== "Stopped" ||
        state.ProcessId !== 0 ||
        state.PathName !== serviceCommand(definition, host.windowsSid!)
    )
        unavailable();
    host.exec("sc.exe", ["delete", SERVICE_NAME], { timeoutMs: 5000 });
}
