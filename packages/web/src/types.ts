import type { AdapterCapabilityManifest } from "@onebots/core";

export interface AccountInfo {
    uin: string;
    status: string;
    avatar: string;
    platform: string;
    nickname: string;
    dependency?: string;
    urls: string[];
    protocols: ProtocolRuntimeInfo[];
}

export interface ProtocolRuntimeInfo {
    name: string;
    version: string;
    path: string;
    lifecycleStatus: "pending" | "starting" | "ready" | "stopping" | "stopped" | "failed";
}

export type CPUInfo = {
    model: string;
    speed: number;
    times: { user: number; irq: number; nice: number; sys: number; idle: number };
};

export interface SystemInfo {
    free_memory: number;
    node_version: string;
    process_cwd: string;
    process_id: number;
    process_parent_id: number;
    process_use_memory: number;
    application_name?: string;
    application_version?: string;
    core_version?: string;
    /** @deprecated 兼容旧版后端，优先使用 core_version。 */
    sdk_version: string;
    uptime: number;
    system_arch: string;
    system_cpus: CPUInfo[];
    system_platform: string;
    system_uptime: number;
    system_version: string;
    total_memory: number;
    username: string;
    /** 当前是否为自动生成的默认账号，应提示用户修改密码 */
    isDefaultCredentials?: boolean;
    /** 配置目录（Docker 下多为 /data，便于确认卷挂载） */
    configDir?: string;
    /** 配置文件路径 */
    configPath?: string;
    /** 数据目录（数据库、日志等） */
    dataDir?: string;
    /** 当前进程已通过加载与注册校验的插件包。 */
    plugins: LoadedPluginInfo[];
    /** 当前磁盘配置与进程最近成功应用版本的关系。 */
    configState: RuntimeConfigState;
    /** 当前进程退出后是否有守护器或编排器负责拉起新实例。 */
    restartSupported?: boolean;
}

export interface RuntimeConfigState {
    status: "in_sync" | "drifted" | "unavailable";
    appliedAt: string;
    message: string;
}

export interface LoadedPluginInfo {
    type: "adapter" | "protocol";
    name: string;
    packageName: string;
    version: string | null;
    entryPath: string;
}

export interface AdapterInfo {
    platform: string;
    displayName: string;
    description: string;
    icon: string;
    capabilities: AdapterCapabilityManifest;
    /** false 表示插件已加载，但未注册可信的默认能力清单。 */
    capabilityDeclared?: boolean;
    /** 仅包含与适配器默认清单不同的账号级能力覆写。 */
    accountCapabilities?: Record<string, AdapterCapabilityManifest>;
    /** 动态账号能力无法形成可信清单时的隔离诊断。 */
    accountCapabilityErrors?: Record<string, { code: "capability_unavailable"; message: string }>;
    /** 能力证据来自当前进程，或尚未加载插件的版本化目录快照。 */
    capabilitySource?: "runtime" | "catalog";
    capabilityPackageVersion?: string | null;
    accounts: AccountInfo[];
}

export interface ProtocolInfo {
    name: string;
    displayName: string;
    description: string;
    versions: string[];
}

export interface ExtensionSetupStep {
    title: string;
    description: string;
    url?: string;
}

export interface CapabilityCategorySummary {
    total: number;
    supported: number;
    native: number;
    emulated: number;
    unsupported: number;
}

export interface ExtensionCapabilityInfo {
    source: "catalog" | "runtime";
    packageVersion: string | null;
    declared: boolean;
    summary: Record<
        "actions" | "events" | "segments" | "transports",
        CapabilityCategorySummary
    > | null;
    manifest: AdapterCapabilityManifest | null;
}

export interface ExtensionInfo {
    id: string;
    type: "adapter" | "protocol";
    name: string;
    displayName: string;
    description: string;
    packageName: string;
    configurationTarget:
        | { kind: "account"; platform: string }
        | { kind: "protocol"; protocolKey: string };
    configurationError: string | null;
    catalogError: string | null;
    /** 当前运行目录不能安全安装扩展时提供可操作原因；旧版服务端可能不返回。 */
    runtimeError?: string | null;
    /** 需要修改依赖但当前进程找不到所选包管理器时提供原因。 */
    packageManagerError?: string | null;
    /** 启动配置无法安全读取时提供脱敏原因；能力目录仍可浏览。 */
    runtimeConfigError?: string | null;
    targetVersion: string | null;
    installedVersion: string | null;
    /** 磁盘包清单无法证明目录中的包身份时提供具体原因。 */
    installedError?: string | null;
    versionAligned: boolean;
    setup: ExtensionSetupStep[];
    installed: boolean;
    enabled: boolean;
    loaded: boolean;
    /** 当前服务实例能否在退出后由监督器自动拉起。 */
    restartSupported?: boolean;
    installing: boolean;
    /** 当前服务端安装操作；旧版服务端可能不返回该字段。 */
    installation?: {
        operationId: string;
        phase: "installing_package" | "preflighting" | "restoring_package";
        startedAt: string;
    } | null;
    /** 当前服务实例内最近一次安装终态；开始下一次安装或服务重启后更新/清空。 */
    lastInstallation?: {
        operationId: string;
        status: "succeeded" | "failed";
        startedAt: string;
        completedAt: string;
        message: string | null;
    } | null;
    /** 适配器能力来自已加载插件的运行时契约，或安装前可见的版本化目录快照。 */
    capability: ExtensionCapabilityInfo | null;
}

/** 验证请求展示块（Web 按 type 通用渲染） */
export type VerificationBlock =
    | { type: "image"; base64: string; alt?: string }
    | { type: "image_url"; url: string; alt?: string }
    | { type: "qrcode"; content: string; alt?: string }
    | { type: "link"; url: string; label?: string }
    | { type: "text"; content: string }
    | { type: "input"; key: string; placeholder?: string; maxLength?: number; secret?: boolean };

/** 验证面板快捷操作 */
export interface VerificationAction {
    id: string;
    label: string;
    variant?: "primary" | "secondary";
}

/** 验证请求展示配置 */
export interface VerificationRequestOptions {
    blocks?: VerificationBlock[];
}

/** 登录验证请求（hint、options 由适配器提供，全平台通用） */
export interface VerificationRequest {
    platform: string;
    account_id: string;
    type: string;
    hint: string;
    options?: VerificationRequestOptions;
    /** 为 true 时显示「发送验证码」按钮（如 ICQQ 设备锁短信验证） */
    requestSmsAvailable?: boolean;
    /** 为 true 时显示「继续」确认按钮（无需输入的验证，如扫码/身份验证后继续登录） */
    confirmable?: boolean;
    /** 「确认」按钮文案，默认「已完成，继续登录」 */
    confirmLabel?: string;
    /** 额外快捷操作（如「重新登录」） */
    actions?: VerificationAction[];
    data?: Record<string, unknown>;
    request_id?: string;
}

/** SSE 清除事件 */
export interface VerificationClearEvent {
    event: "clear";
    platform: string;
    account_id: string;
    type?: string;
}
