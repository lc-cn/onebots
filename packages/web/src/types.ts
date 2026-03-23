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
    /** 当前是否为自动生成的默认账号，应提示用户修改密码 */
    isDefaultCredentials?: boolean;
    /** 配置目录（Docker 下多为 /data，便于确认卷挂载） */
    configDir?: string;
    /** 配置文件路径 */
    configPath?: string;
    /** 数据目录（数据库、日志等） */
    dataDir?: string;
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

/** 验证请求展示块（Web 按 type 通用渲染） */
export type VerificationBlock =
    | { type: 'image'; base64: string; alt?: string }
    | { type: 'image_url'; url: string; alt?: string }
    | { type: 'link'; url: string; label?: string }
    | { type: 'text'; content: string }
    | { type: 'input'; key: string; placeholder?: string; maxLength?: number; secret?: boolean }

/** 验证请求展示配置 */
export interface VerificationRequestOptions {
    blocks?: VerificationBlock[]
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
    data?: Record<string, unknown>;
    request_id?: string;
}
