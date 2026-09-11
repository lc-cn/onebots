import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { SERVICE_NAME, type ServiceScope } from "./service-definition.js";
import { buildManagerServiceArgs, parseManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
import {
    hasExactWindowsStatusKeys as exactKeys,
    isPlainWindowsStatusObject as plainObject,
    parseSingleWindowsStatusLine as singleJsonLine,
    parseWindowsNativeStatus,
    windowsServiceUnavailable as unavailable,
    type WindowsNativeStatus,
} from "./windows-native-status.js";

export {
    parseWindowsNativeStatus,
    WINDOWS_CONTROL_FRESHNESS_MS,
    type WindowsNativeStatus,
} from "./windows-native-status.js";

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
    Config: {
        ServiceType: "own-process";
        ErrorControl: "normal";
        LoadOrderGroup: "";
        Dependencies: [];
        ServiceStartName: "LocalSystem";
        DisplayName: "OneBots Control Service";
        TagId: 0;
        Description: "";
        SidType: 0;
        DelayedAutoStart: false;
    };
}

export const WINDOWS_HOST_PIPE_NAME = `\\\\.\\pipe\\${SERVICE_NAME}-control`;

function parseScmState(output: string): WindowsScmState | null {
    const text = singleJsonLine(output, 16_384);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        unavailable();
    }
    if (!plainObject(value)) unavailable();
    const stateKeys = ["loaded", "path", "state", "processId", "enabled"];
    if (
        !exactKeys(value, value.loaded === true ? [...stateKeys, "startMode", "config"] : stateKeys)
    )
        unavailable();
    const config = value.config;
    if (
        typeof value.loaded !== "boolean" ||
        typeof value.enabled !== "boolean" ||
        (value.loaded && !["auto", "manual", "disabled"].includes(String(value.startMode))) ||
        (value.loaded && value.enabled !== (value.startMode === "auto")) ||
        !["running", "stopped", "transitioning"].includes(String(value.state)) ||
        typeof value.processId !== "number" ||
        !Number.isSafeInteger(value.processId) ||
        value.processId < 0 ||
        value.processId > 0xffffffff ||
        typeof value.path !== "string" ||
        (value.loaded && !value.path) ||
        (!value.loaded && (value.path || value.processId !== 0 || value.state !== "stopped"))
    )
        unavailable();
    if (!value.loaded) return null;
    if (
        !plainObject(config) ||
        !exactKeys(config, [
            "serviceType",
            "errorControl",
            "loadOrderGroup",
            "dependencies",
            "serviceStartName",
            "displayName",
            "tagId",
            "description",
            "sidType",
            "delayedAutoStart",
        ]) ||
        config.serviceType !== "own-process" ||
        config.errorControl !== "normal" ||
        config.loadOrderGroup !== "" ||
        !Array.isArray(config.dependencies) ||
        config.dependencies.length !== 0 ||
        config.serviceStartName !== "LocalSystem" ||
        config.displayName !== "OneBots Control Service" ||
        config.tagId !== 0 ||
        config.description !== "" ||
        config.sidType !== 0 ||
        config.delayedAutoStart !== false
    )
        unavailable();
    return {
        Name: SERVICE_NAME,
        State:
            value.state === "running"
                ? "Running"
                : value.state === "stopped"
                  ? "Stopped"
                  : "Start Pending",
        StartMode:
            value.startMode === "auto"
                ? "Auto"
                : value.startMode === "manual"
                  ? "Manual"
                  : "Disabled",
        ProcessId: value.processId,
        PathName: value.path,
        Config: {
            ServiceType: "own-process",
            ErrorControl: "normal",
            LoadOrderGroup: "",
            Dependencies: [],
            ServiceStartName: "LocalSystem",
            DisplayName: "OneBots Control Service",
            TagId: 0,
            Description: "",
            SidType: 0,
            DelayedAutoStart: false,
        },
    };
}

function scmRequest(request: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(request)).toString("base64url");
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
        value.pipeName !== WINDOWS_HOST_PIPE_NAME ||
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
                managerArguments: [
                    ...buildManagerServiceArgs(spec),
                    "--windows-host-pipe",
                    WINDOWS_HOST_PIPE_NAME,
                ],
                workingDirectory: spec.workingDirectory,
                pipeName: WINDOWS_HOST_PIPE_NAME,
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

export interface WindowsServiceObservation {
    service: ServicePlatformState;
    control?: NonNullable<WindowsNativeStatus["state"]["control"]>;
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
    private scm(
        definition: WindowsServiceDefinition,
        request: Record<string, unknown> = { operation: "inspect", expectedLoaded: false },
    ): WindowsScmState | null {
        return parseScmState(
            this.host.exec(
                definition.hostExecutable,
                ["scm-control", "--request", scmRequest(request)],
                { timeoutMs: 125_000 },
            ),
        );
    }
    async inspect(): Promise<ServicePlatformState> {
        return (await this.inspectNative()).service;
    }
    async inspectNative(): Promise<WindowsServiceObservation> {
        const definition = this.definition();
        const scm = this.scm(definition);
        if (!scm)
            return {
                service: {
                    state: "stopped",
                    running: false,
                    enabled: false,
                    loaded: false,
                    definitionPath: this.expectedDefinitionPath,
                    processId: null,
                    identity: null,
                    quiescent: true,
                },
            };
        if (scm.PathName !== serviceCommand(definition, this.host.windowsSid!)) unavailable();
        const running = scm.State !== "Stopped";
        let identity: string | null = null;
        let managerPid: number | null = null;
        let control: WindowsServiceObservation["control"];
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
                control = status.state.control;
            } catch {
                // SCM已运行但宿主管道尚未就绪时只能报告转换态，不能拼出实例身份。
            }
        }
        return {
            service: {
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
            },
            ...(control ? { control } : {}),
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
        const definition = this.definition();
        const before = this.scm(definition);
        if (!before) return;
        if (before.PathName !== serviceCommand(definition, this.host.windowsSid!)) unavailable();
        this.scm(definition, {
            operation: "quiesce",
            expectedLoaded: true,
            expectedPath: serviceCommand(definition, this.host.windowsSid!),
            expectedStartMode: before.StartMode.toLowerCase(),
        });
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
        const before = this.scm(definition);
        if (before && before.PathName !== command) unavailable();
        this.scm(definition, {
            operation: "configure",
            expectedLoaded: before !== null,
            ...(before
                ? { expectedPath: command, expectedStartMode: before.StartMode.toLowerCase() }
                : {}),
            targetPath: command,
            enabled,
        });
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
        const scm = this.scm(current);
        if (
            !scm ||
            scm.State !== "Stopped" ||
            scm.ProcessId !== 0 ||
            scm.PathName !== serviceCommand(previous, this.host.windowsSid!)
        )
            unavailable();
        this.scm(current, {
            operation: "configure",
            expectedLoaded: true,
            expectedPath: serviceCommand(previous, this.host.windowsSid!),
            expectedStartMode: scm.StartMode.toLowerCase(),
            targetPath: serviceCommand(current, this.host.windowsSid!),
            enabled,
        });
        return this.stable(
            state => state.loaded && state.enabled === enabled && state.state === "stopped",
        );
    }
    async start(expectedInitialState?: ServicePlatformState): Promise<ServicePlatformState> {
        const initial = await this.inspect();
        if (expectedInitialState && !isDeepStrictEqual(initial, expectedInitialState))
            unavailable();
        if (!initial.loaded || !initial.quiescent) unavailable();
        const definition = this.definition();
        const scm = this.scm(definition);
        if (
            !scm ||
            scm.PathName !== serviceCommand(definition, this.host.windowsSid!) ||
            (scm.StartMode === "Auto") !== initial.enabled
        )
            unavailable();
        this.scm(definition, {
            operation: "start",
            expectedLoaded: true,
            expectedPath: serviceCommand(definition, this.host.windowsSid!),
            expectedStartMode: scm.StartMode.toLowerCase(),
        });
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
    const current = parseScmState(
        host.exec(
            definition.hostExecutable,
            [
                "scm-control",
                "--request",
                scmRequest({ operation: "inspect", expectedLoaded: false }),
            ],
            { timeoutMs: 125_000 },
        ),
    );
    if (!current || current.PathName !== serviceCommand(definition, host.windowsSid)) unavailable();
    const state = parseScmState(
        host.exec(
            definition.hostExecutable,
            [
                "scm-control",
                "--request",
                scmRequest({
                    operation: "delete",
                    expectedLoaded: true,
                    expectedPath: serviceCommand(definition, host.windowsSid),
                    expectedStartMode: current.StartMode.toLowerCase(),
                }),
            ],
            { timeoutMs: 125_000 },
        ),
    );
    if (state !== null) unavailable();
}
