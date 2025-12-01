export interface AccountInfo {
    uin: string;
    status: string;
    avatar: string;
    platform: string;
    nickname: string;
    dependency?: string;
    urls: string[];
}

// 保持向后兼容
export type BotInfo = AccountInfo;

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
    sdk_version: string;
    uptime: number;
    system_arch: string;
    system_cpus: CPUInfo[];
    system_platform: string;
    system_uptime: number;
    system_version: string;
    total_memory: number;
    username: string;
}

export interface AdapterInfo {
    platform: string;
    icon: string;
    accounts: AccountInfo[];
}

export interface ProtocolInfo {
    name: string;
    displayName: string;
    description: string;
    versions: string[];
}
