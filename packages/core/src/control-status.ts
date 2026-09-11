/** 无服务器或插件依赖的控制状态契约，CLI/TUI/Web 共用此入口。 */
export interface ControlStatus {
    schemaVersion: 1;
    manager: { id: string; version: string; pid?: number };
    system?: ControlSystemStatus;
    serviceMigration?: { pending: boolean; recoveryRequired: boolean };
    processOwnership?: { available: boolean };
    /** 来自当前网关进程的最小账号摘要；不包含配置、昵称、凭据或平台 SDK 数据。 */
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
}

export interface ControlOperation {
    id: string;
    action: "start" | "stop" | "restart" | "shutdown" | "reconcile" | "suspend";
    status: "running" | "succeeded" | "failed";
    startedAt: string;
    finishedAt?: string;
    error?: string;
}
