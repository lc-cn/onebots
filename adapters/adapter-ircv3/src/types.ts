export type Ircv3ReceiveMode = "connection" | "manual";
export type Ircv3SaslMechanism = "PLAIN" | "EXTERNAL";

export interface Ircv3ChannelConfig {
    name: string;
    key?: string;
    auto_join?: boolean;
}

/** IRCv3 账号配置。直连、已有 socket 与 ingest() 共用同一会话状态机。 */
export interface Ircv3Config {
    account_id: string;
    host?: string;
    port?: number;
    tls?: boolean;
    tls_servername?: string;
    tls_reject_unauthorized?: boolean;
    tls_client_cert_path?: string;
    tls_client_key_path?: string;
    tls_client_key_passphrase?: string;
    server_password?: string;
    nickname: string;
    username?: string;
    realname?: string;
    receive_mode?: Ircv3ReceiveMode;
    channels?: Ircv3ChannelConfig[];
    requested_capabilities?: string[];
    event_commands?: string[];
    sasl_mechanism?: Ircv3SaslMechanism;
    sasl_username?: string;
    sasl_password?: string;
    sasl_authzid?: string;
    sasl_required?: boolean;
    reconnect_initial_delay_ms?: number;
    reconnect_max_delay_ms?: number;
    connect_timeout_ms?: number;
    command_timeout_ms?: number;
    max_line_bytes?: number;
}

export interface Ircv3Prefix {
    raw: string;
    nick?: string;
    user?: string;
    host?: string;
    server?: string;
}

/** 完整且无损的 IRC message；tag key 大小写敏感，command 已规范为大写。 */
export interface Ircv3Message {
    raw: string;
    tags: Readonly<Record<string, string | null>>;
    source?: Ircv3Prefix;
    command: string;
    params: readonly string[];
}

export interface Ircv3Delivery {
    id: string;
    message: Ircv3Message;
    receivedAt: number;
    replayed: boolean;
    batch?: {
        id: string;
        type?: string;
        params: readonly string[];
    };
}

export interface Ircv3IngestResult {
    accepted: boolean;
    filtered: boolean;
    delivery: Ircv3Delivery;
}

export interface Ircv3SessionSnapshot {
    connected: boolean;
    registered: boolean;
    nickname: string;
    account?: string;
    server?: string;
    availableCapabilities: Readonly<Record<string, string | null>>;
    enabledCapabilities: readonly string[];
    isupport: Readonly<Record<string, string | null>>;
    joinedChannels: readonly string[];
    operator: boolean;
}

export interface Ircv3CommandOptions {
    tags?: Readonly<Record<string, string | null | undefined>>;
    signal?: AbortSignal;
}

export interface Ircv3RequestOptions extends Ircv3CommandOptions {
    /** 结束本次响应的 numeric/command；legacy server 上请求会串行执行。 */
    endCommands: readonly string[];
    errorCommands?: readonly string[];
    timeoutMs?: number;
}

/** net.Socket、tls.TLSSocket 与 WebSocket bridge 可实现的最小双向连接接口。 */
export interface Ircv3Socket {
    on(event: "data" | "message", listener: (data: unknown) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    off(event: "data" | "message", listener: (data: unknown) => void): this;
    off(event: "close", listener: () => void): this;
    off(event: "error", listener: (error: Error) => void): this;
    write?(data: string): boolean;
    send?(data: string): void;
    end?(): void;
    destroy?(): void;
    close?(): void;
}

export interface Ircv3SocketAttachOptions {
    /** false 时 stop()/换代仅解绑，不关闭宿主拥有的连接。 */
    owned?: boolean;
    /** true 表示外部连接已完成注册；同时提供其已协商状态。 */
    registered?: boolean;
    nickname?: string;
    account?: string;
    server?: string;
    enabledCapabilities?: Readonly<Record<string, string | null>>;
    isupport?: Readonly<Record<string, string | null>>;
}

export interface Ircv3ConnectOptions {
    host: string;
    port: number;
    tls: boolean;
    timeoutMs: number;
    tlsOptions: {
        servername?: string;
        rejectUnauthorized: boolean;
        clientCertPath?: string;
        clientKeyPath?: string;
        clientKeyPassphrase?: string;
    };
    signal: AbortSignal;
}

export interface Ircv3ClientDependencies {
    connect?: (options: Ircv3ConnectOptions) => Promise<Ircv3Socket>;
    now?: () => number;
    random?: () => number;
    reportError?: (error: Error) => void;
}

export interface Ircv3ClientEvents {
    ready: [snapshot: Ircv3SessionSnapshot];
    connected: [snapshot: Ircv3SessionSnapshot];
    disconnected: [error?: Error];
    event: [delivery: Ircv3Delivery];
    raw: [message: Ircv3Message];
    error: [error: Error];
    stop: [];
}
