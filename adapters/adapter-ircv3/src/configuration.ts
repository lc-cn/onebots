import { IRC_DEFAULT_MAX_LINE_BYTES } from "./codec.js";
import { Ircv3Error } from "./errors.js";
import type { Ircv3ChannelConfig, Ircv3Config } from "./types.js";

export const IRCV3_STABLE_CAPABILITIES = Object.freeze([
    "account-notify",
    "account-tag",
    "away-notify",
    "batch",
    "echo-message",
    "extended-join",
    "invite-notify",
    "labeled-response",
    "message-tags",
    "multi-prefix",
    "server-time",
    "setname",
    "standard-replies",
    "userhost-in-names",
]);

export const IRCV3_EVENT_COMMANDS = Object.freeze([
    "PRIVMSG",
    "NOTICE",
    "TAGMSG",
    "JOIN",
    "PART",
    "KICK",
    "QUIT",
    "NICK",
    "INVITE",
    "TOPIC",
    "MODE",
    "ACCOUNT",
    "AWAY",
    "CHGHOST",
    "SETNAME",
    "ERROR",
]);

const CAPABILITY_PATTERN = /^(?:[a-z0-9][a-z0-9.-]*\/)?[a-z0-9][a-z0-9-]*$/u;
const NICK_PATTERN = /^[^\0\r\n ,:*?!@.][^\0\r\n ,:*?!@]*$/u;

export interface NormalizedIrcv3Config extends Ircv3Config {
    host: string;
    port: number;
    tls: boolean;
    tls_reject_unauthorized: boolean;
    username: string;
    realname: string;
    receive_mode: "connection" | "manual";
    channels: Ircv3ChannelConfig[];
    requested_capabilities: string[];
    event_commands: string[];
    sasl_required: boolean;
    reconnect_initial_delay_ms: number;
    reconnect_max_delay_ms: number;
    connect_timeout_ms: number;
    command_timeout_ms: number;
    max_line_bytes: number;
}

export function normalizeIrcv3Config(config: Ircv3Config): NormalizedIrcv3Config {
    assertIrcv3ConfigShape(config);
    const tlsEnabled = config.tls !== false;
    const normalized: NormalizedIrcv3Config = {
        ...config,
        host: config.host?.trim() || "",
        nickname: config.nickname?.trim(),
        username: (config.username || config.nickname)?.trim(),
        realname: (config.realname || "OneBots IRCv3")?.trim(),
        port: config.port ?? (tlsEnabled ? 6697 : 6667),
        tls: tlsEnabled,
        tls_reject_unauthorized: config.tls_reject_unauthorized !== false,
        receive_mode: config.receive_mode || "connection",
        channels: (config.channels || []).map(channel => ({
            ...channel,
            name: channel.name.trim(),
            auto_join: channel.auto_join !== false,
        })),
        requested_capabilities: unique(config.requested_capabilities || IRCV3_STABLE_CAPABILITIES),
        event_commands: unique(
            (config.event_commands || IRCV3_EVENT_COMMANDS).map(command => command.toUpperCase()),
        ),
        sasl_required: config.sasl_required === true,
        reconnect_initial_delay_ms: config.reconnect_initial_delay_ms ?? 1_000,
        reconnect_max_delay_ms: config.reconnect_max_delay_ms ?? 60_000,
        connect_timeout_ms: config.connect_timeout_ms ?? 15_000,
        command_timeout_ms: config.command_timeout_ms ?? 15_000,
        max_line_bytes: config.max_line_bytes ?? IRC_DEFAULT_MAX_LINE_BYTES,
    };
    assertIrcv3Config(normalized);
    return normalized;
}

export function assertIrcv3Config(config: Ircv3Config): asserts config is NormalizedIrcv3Config {
    requiredText(config.account_id, "account_id");
    if ((config.receive_mode || "connection") === "connection") requiredText(config.host, "host");
    if (config.host && /[:/\s\0\r\n]/u.test(config.host)) {
        throw Ircv3Error.invalid("host 只能填写主机名或 IP，不包含协议、端口或路径");
    }
    requiredText(config.nickname, "nickname");
    if (!NICK_PATTERN.test(config.nickname)) throw Ircv3Error.invalid("nickname 格式无效");
    optionalAtom(config.username, "username");
    optionalSafeText(config.realname, "realname");
    optionalSafeText(config.server_password, "server_password");
    optionalSafeText(config.tls_client_cert_path, "tls_client_cert_path");
    optionalSafeText(config.tls_client_key_path, "tls_client_key_path");
    optionalSafeText(config.tls_client_key_passphrase, "tls_client_key_passphrase");
    if (Boolean(config.tls_client_cert_path) !== Boolean(config.tls_client_key_path)) {
        throw Ircv3Error.invalid("TLS client certificate 与 private key path 必须同时配置");
    }
    integerInRange(config.port, "port", 1, 65_535);
    if (config.receive_mode && !["connection", "manual"].includes(config.receive_mode)) {
        throw Ircv3Error.invalid("receive_mode 必须是 connection 或 manual");
    }
    validateChannels(config.channels || []);
    for (const capability of config.requested_capabilities || []) {
        if (!CAPABILITY_PATTERN.test(capability)) {
            throw Ircv3Error.invalid(`requested capability 无效: ${capability}`);
        }
    }
    const requested = new Set(config.requested_capabilities || []);
    if (requested.has("sasl") && !config.sasl_mechanism) {
        throw Ircv3Error.invalid("sasl capability 由 sasl_mechanism 管理，不能单独请求");
    }
    if (requested.has("labeled-response") && !requested.has("batch")) {
        throw Ircv3Error.invalid("labeled-response 依赖 batch capability");
    }
    for (const command of config.event_commands || []) {
        if (!IRCV3_EVENT_COMMANDS.includes(command.toUpperCase())) {
            throw Ircv3Error.invalid(`event_commands 包含不支持的投影命令: ${command}`);
        }
    }
    validateSasl(config);
    const managed = (config.receive_mode || "connection") === "connection";
    if (managed && config.tls === false && (config.server_password || config.sasl_password)) {
        throw Ircv3Error.invalid("主动明文连接不能发送 server/SASL 密码；请启用 TLS");
    }
    if (
        managed &&
        config.sasl_mechanism === "EXTERNAL" &&
        (!config.tls_client_cert_path || !config.tls_client_key_path)
    ) {
        throw Ircv3Error.invalid(
            "主动连接使用 SASL EXTERNAL 时必须配置 TLS client certificate 与 key",
        );
    }
    integerInRange(config.reconnect_initial_delay_ms, "reconnect_initial_delay_ms", 100, 300_000);
    integerInRange(config.reconnect_max_delay_ms, "reconnect_max_delay_ms", 100, 3_600_000);
    if (
        config.reconnect_initial_delay_ms !== undefined &&
        config.reconnect_max_delay_ms !== undefined &&
        config.reconnect_initial_delay_ms > config.reconnect_max_delay_ms
    ) {
        throw Ircv3Error.invalid("reconnect_initial_delay_ms 不能大于 reconnect_max_delay_ms");
    }
    integerInRange(config.connect_timeout_ms, "connect_timeout_ms", 100, 300_000);
    integerInRange(config.command_timeout_ms, "command_timeout_ms", 100, 300_000);
    integerInRange(config.max_line_bytes, "max_line_bytes", 512, IRC_DEFAULT_MAX_LINE_BYTES);
}

function validateChannels(channels: readonly Ircv3ChannelConfig[]): void {
    const names = new Set<string>();
    for (const channel of channels) {
        requiredText(channel.name, "channels[].name");
        if (/[\0\r\n ,]/u.test(channel.name)) {
            throw Ircv3Error.invalid(`channel name 无效: ${channel.name}`);
        }
        optionalSafeText(channel.key, "channels[].key");
        const normalized = channel.name.toLowerCase();
        if (names.has(normalized)) throw Ircv3Error.invalid(`channel 重复: ${channel.name}`);
        names.add(normalized);
    }
}

function assertIrcv3ConfigShape(config: Ircv3Config): void {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
        throw Ircv3Error.invalid("IRCv3 配置必须是对象");
    }
    for (const field of [
        "account_id",
        "host",
        "tls_servername",
        "tls_client_cert_path",
        "tls_client_key_path",
        "tls_client_key_passphrase",
        "server_password",
        "nickname",
        "username",
        "realname",
        "receive_mode",
        "sasl_mechanism",
        "sasl_username",
        "sasl_password",
        "sasl_authzid",
    ] as const) {
        const value = config[field];
        if (value !== undefined && typeof value !== "string") {
            throw Ircv3Error.invalid(`${field} 必须是字符串`);
        }
    }
    for (const field of ["tls", "tls_reject_unauthorized", "sasl_required"] as const) {
        const value = config[field];
        if (value !== undefined && typeof value !== "boolean") {
            throw Ircv3Error.invalid(`${field} 必须是布尔值`);
        }
    }
    assertStringArray(config.requested_capabilities, "requested_capabilities");
    assertStringArray(config.event_commands, "event_commands");
    if (config.channels !== undefined && !Array.isArray(config.channels)) {
        throw Ircv3Error.invalid("channels 必须是数组");
    }
    for (const [index, channel] of (config.channels || []).entries()) {
        if (typeof channel !== "object" || channel === null || Array.isArray(channel)) {
            throw Ircv3Error.invalid(`channels[${index}] 必须是对象`);
        }
        if (typeof channel.name !== "string") {
            throw Ircv3Error.invalid(`channels[${index}].name 必须是字符串`);
        }
        if (channel.key !== undefined && typeof channel.key !== "string") {
            throw Ircv3Error.invalid(`channels[${index}].key 必须是字符串`);
        }
        if (channel.auto_join !== undefined && typeof channel.auto_join !== "boolean") {
            throw Ircv3Error.invalid(`channels[${index}].auto_join 必须是布尔值`);
        }
    }
}

function assertStringArray(value: unknown, field: string): void {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
        throw Ircv3Error.invalid(`${field} 必须是字符串数组`);
    }
}

function validateSasl(config: Ircv3Config): void {
    if (!config.sasl_mechanism) {
        if (
            config.sasl_required ||
            config.sasl_username ||
            config.sasl_password ||
            config.sasl_authzid
        ) {
            throw Ircv3Error.invalid("配置 SASL 字段时必须选择 sasl_mechanism");
        }
        return;
    }
    if (!["PLAIN", "EXTERNAL"].includes(config.sasl_mechanism)) {
        throw Ircv3Error.invalid("sasl_mechanism 仅支持官方稳定的 PLAIN 或 EXTERNAL");
    }
    if (config.sasl_mechanism === "PLAIN") {
        requiredText(config.sasl_username, "sasl_username");
        requiredText(config.sasl_password, "sasl_password");
    } else if (config.sasl_username || config.sasl_password) {
        throw Ircv3Error.invalid("SASL EXTERNAL 只使用可选 sasl_authzid，不接受 username/password");
    }
    optionalSafeText(config.sasl_username, "sasl_username");
    optionalSafeText(config.sasl_password, "sasl_password");
    optionalSafeText(config.sasl_authzid, "sasl_authzid");
}

function requiredText(value: unknown, field: string): asserts value is string {
    if (typeof value !== "string" || !value.trim()) throw Ircv3Error.invalid(`${field} 不能为空`);
}

function optionalSafeText(value: unknown, field: string): void {
    if (value === undefined) return;
    if (typeof value !== "string" || /[\0\r\n]/u.test(value)) {
        throw Ircv3Error.invalid(`${field} 包含非法字符`);
    }
}

function optionalAtom(value: unknown, field: string): void {
    optionalSafeText(value, field);
    if (typeof value === "string" && /[ :]/u.test(value)) {
        throw Ircv3Error.invalid(`${field} 不能包含空格或冒号`);
    }
}

function integerInRange(value: unknown, field: string, min: number, max: number): void {
    if (value === undefined) return;
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw Ircv3Error.invalid(`${field} 必须是 ${min}-${max} 的安全整数`);
    }
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}
