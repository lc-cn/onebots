/** 无服务器或插件依赖的控制状态契约，CLI/TUI/Web 共用此入口。 */
export interface ControlStatus {
    schemaVersion: 1;
    manager: { id: string; version: string; pid?: number };
    system?: ControlSystemStatus;
    serviceMigration?: { pending: boolean; recoveryRequired: boolean };
    processOwnership?: { available: boolean };
    /** 来自当前网关进程的最小账号摘要；不包含配置、昵称或凭据。 */
    accounts?: {
        available: boolean;
        items: ControlAccountStatus[];
    };
    gateway: {
        desired: "running" | "stopped";
        actual: "starting" | "running" | "stopping" | "stopped" | "failed";
        instance?: { id: string };
        recoveryRequired: boolean;
        error?: string;
        operations: ControlOperation[];
    };
}

/** 管理服务所在运行环境的资源快照；不代表容器配额或网关进程占用。 */
export interface ControlSystemStatus {
    sampledAt: string;
    nodeVersion: string;
    platform: string;
    release: string;
    arch: string;
    hostname: string;
    cpuModel: string;
    logicalCpus: number;
    uptimeSeconds: number;
    managerUptimeSeconds: number;
    memory: {
        total: number;
        free: number;
        managerRss: number;
        heapUsed: number;
        heapTotal: number;
    };
    disk: {
        state: "pending" | "ready" | "unavailable";
        sampledAt?: string;
        total?: number;
        used?: number;
        available?: number;
    };
}

export interface ControlAccountStatus {
    platform: string;
    accountId: string;
    status: "pending" | "online" | "offline";
    /** 仅允许 HTTPS 图片地址；缺失时使用平台图标或文字标识。 */
    avatarUrl?: string;
    platformIconUrl?: string;
    /** 来自当前账号的协议生命周期；不是外部网络连通性检测。 */
    protocols?: Array<{
        name: string;
        version: string;
        status: "pending" | "starting" | "ready" | "stopping" | "stopped" | "failed";
    }>;
}

export interface ControlOperation {
    id: string;
    action: "start" | "stop" | "restart" | "shutdown" | "reconcile" | "suspend";
    status: "running" | "succeeded" | "failed";
    startedAt: string;
    finishedAt?: string;
    error?: string;
}
