import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";
import SMTPPool from "nodemailer/lib/smtp-pool/index.js";
import SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { ImapFlow } from "imapflow";
import { EmailError } from "./errors.js";
import type { EmailConfig, EmailImapConfig, EmailSendResult } from "./types.js";

export interface EmailSmtpTransport {
    verify(): Promise<true>;
    sendMail(options: Mail.Options): Promise<EmailSendResult>;
    close(): void;
}

/** 创建可选连接池、OAuth2 与代理的 SMTP 传输。 */
export function createSmtpTransport(config: EmailConfig): EmailSmtpTransport {
    const security = config.smtp.security || "starttls";
    const common = {
        host: config.smtp.host,
        port: config.smtp.port || (security === "tls" ? 465 : 587),
        secure: security === "tls",
        requireTLS: security === "starttls",
        ignoreTLS: security === "plain",
        auth: smtpAuth(config),
        proxy: resolveProxyUrl(config),
        connectionTimeout: config.smtp.connection_timeout_ms,
        greetingTimeout: config.smtp.greeting_timeout_ms,
        socketTimeout: config.smtp.socket_timeout_ms,
        tls: { rejectUnauthorized: config.smtp.reject_unauthorized !== false },
    };
    if (config.smtp.pool) {
        const options: SMTPPool.Options = {
            ...common,
            pool: true,
            maxConnections: config.smtp.max_connections,
            maxMessages: config.smtp.max_messages,
        };
        const transporter = nodemailer.createTransport(options);
        return wrapSmtpTransport(transporter);
    }
    const options: SMTPTransport.Options = common;
    const transporter = nodemailer.createTransport(options);
    return wrapSmtpTransport(transporter);
}

/** 创建开启自动 IDLE、证书校验和代理支持的 IMAP 客户端。 */
export function createImapClient(config: EmailConfig): ImapFlow {
    const imap = requireEmailImapConfig(config);
    const security = imap.security || "tls";
    const authMode = resolveEmailAuthMode(config);
    return new ImapFlow({
        host: imap.host,
        port: imap.port || (security === "tls" ? 993 : 143),
        secure: security === "tls",
        doSTARTTLS: security === "starttls" ? true : security === "plain" ? false : undefined,
        auth: {
            user: config.auth.user,
            pass: authMode === "password" ? config.auth.password : undefined,
            accessToken: authMode === "oauth2" ? config.auth.access_token : undefined,
        },
        proxy: resolveProxyUrl(config),
        tls: { rejectUnauthorized: imap.reject_unauthorized !== false },
        connectionTimeout: imap.connection_timeout_ms,
        greetingTimeout: imap.greeting_timeout_ms,
        socketTimeout: imap.socket_timeout_ms,
        maxIdleTime: imap.max_idle_time_ms,
        logger: false,
    });
}

/** 校验运行时配置中无法由静态 Schema 表达的互斥条件。 */
export function validateEmailConfig(config: EmailConfig): void {
    const receiveMode = resolveEmailReceiveMode(config);
    for (const [field, value] of [
        ["account_id", config.account_id],
        ["address", config.address],
        ["auth.user", config.auth?.user],
        ["smtp.host", config.smtp?.host],
    ] as const) {
        if (!value?.trim()) {
            throw new EmailError(`${field} 不能为空`, { code: "EMAIL_CONFIG_INVALID" });
        }
    }
    if (receiveMode === "imap" && !config.imap?.host?.trim()) {
        throw new EmailError("imap 模式必须配置 imap.host", {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.address)) {
        throw new EmailError("address 不是有效邮箱地址", { code: "EMAIL_CONFIG_INVALID" });
    }
    validateSecurity("smtp.security", config.smtp.security);
    validateSecurity("imap.security", config.imap?.security);
    validatePort("smtp.port", config.smtp.port);
    validatePort("imap.port", config.imap?.port);
    const authMode = resolveEmailAuthMode(config);
    if (authMode === "password" && !config.auth.password?.trim()) {
        throw new EmailError("password 认证方式必须配置 auth.password", {
            code: "EMAIL_AUTH_REQUIRED",
        });
    }
    if (authMode === "oauth2" && !config.auth.access_token?.trim()) {
        throw new EmailError("oauth2 认证方式必须配置 auth.access_token", {
            code: "EMAIL_AUTH_REQUIRED",
        });
    }
    for (const [field, value, minimum] of [
        ["smtp.max_connections", config.smtp.max_connections, 1],
        ["smtp.max_messages", config.smtp.max_messages, 1],
        ["smtp.connection_timeout_ms", config.smtp.connection_timeout_ms, 1],
        ["smtp.greeting_timeout_ms", config.smtp.greeting_timeout_ms, 1],
        ["smtp.socket_timeout_ms", config.smtp.socket_timeout_ms, 1],
        ["imap.poll_interval_ms", config.imap?.poll_interval_ms, 0],
        ["imap.retry_initial_delay_ms", config.imap?.retry_initial_delay_ms, 100],
        ["imap.retry_max_delay_ms", config.imap?.retry_max_delay_ms, 1_000],
        ["imap.connection_timeout_ms", config.imap?.connection_timeout_ms, 1],
        ["imap.greeting_timeout_ms", config.imap?.greeting_timeout_ms, 1],
        ["imap.socket_timeout_ms", config.imap?.socket_timeout_ms, 1],
        ["imap.max_idle_time_ms", config.imap?.max_idle_time_ms, 1_000],
    ] as const) {
        validateIntegerMinimum(field, value, minimum);
    }
    if (
        config.imap?.retry_initial_delay_ms !== undefined &&
        config.imap.retry_max_delay_ms !== undefined &&
        config.imap.retry_initial_delay_ms > config.imap.retry_max_delay_ms
    ) {
        throw new EmailError("imap.retry_initial_delay_ms 不能大于 retry_max_delay_ms", {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
    resolveProxyUrl(config);
}

export function resolveEmailReceiveMode(config: EmailConfig): "imap" | "manual" {
    const mode = config.receive_mode || "imap";
    if (mode !== "imap" && mode !== "manual") {
        throw new EmailError("receive_mode 必须是 imap 或 manual", {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
    return mode;
}

export function requireEmailImapConfig(config: EmailConfig): EmailImapConfig {
    if (resolveEmailReceiveMode(config) !== "imap" || !config.imap) {
        throw new EmailError("当前邮件账号未启用 IMAP", {
            code: "EMAIL_IMAP_DISABLED",
        });
    }
    return config.imap;
}

/** 解析最终认证方式，供 SMTP 与 IMAP 共用同一决策。 */
export function resolveEmailAuthMode(config: EmailConfig): "password" | "oauth2" {
    const method = config.auth?.method;
    if (method !== undefined && method !== "password" && method !== "oauth2") {
        throw new EmailError("auth.method 必须是 password 或 oauth2", {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
    return method || (config.auth?.access_token ? "oauth2" : "password");
}

function validateSecurity(field: string, value: unknown): void {
    if (value !== undefined && value !== "tls" && value !== "starttls" && value !== "plain") {
        throw new EmailError(`${field} 必须是 tls、starttls 或 plain`, {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
}

function validatePort(field: string, value: unknown): void {
    if (
        value !== undefined &&
        (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535)
    ) {
        throw new EmailError(`${field} 必须是 1 到 65535 之间的整数`, {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
}

function validateIntegerMinimum(field: string, value: unknown, minimum: number): void {
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < minimum)) {
        throw new EmailError(`${field} 必须是大于等于 ${minimum} 的整数`, {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
}

function wrapSmtpTransport<T>(transporter: {
    verify(): Promise<true>;
    sendMail(options: Mail.Options): Promise<T>;
    close(): void;
}): EmailSmtpTransport {
    return {
        verify: () => transporter.verify(),
        close: () => transporter.close(),
        sendMail: async options => normalizeSendResult(await transporter.sendMail(options)),
    };
}

function normalizeSendResult(value: unknown): EmailSendResult {
    if (!isRecord(value) || typeof value.messageId !== "string") {
        throw new EmailError("SMTP 返回结构无效", { code: "EMAIL_INVALID_SMTP_RESPONSE" });
    }
    return {
        message_id: value.messageId,
        accepted: addressResults(value.accepted),
        rejected: addressResults(value.rejected),
        response: typeof value.response === "string" ? value.response : "",
    };
}

function smtpAuth(config: EmailConfig): SMTPTransport.Options["auth"] {
    return resolveEmailAuthMode(config) === "oauth2"
        ? { type: "OAuth2", user: config.auth.user, accessToken: config.auth.access_token }
        : { user: config.auth.user, pass: config.auth.password };
}

function resolveProxyUrl(config: EmailConfig): string | undefined {
    if (!config.proxy?.url) return undefined;
    let url: URL;
    try {
        url = new URL(config.proxy.url);
    } catch (error) {
        throw new EmailError("邮件代理地址不是有效 URL", {
            code: "EMAIL_INVALID_PROXY",
            cause: error,
        });
    }
    if (!["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:"].includes(url.protocol)) {
        throw new EmailError(`不支持的邮件代理协议 ${url.protocol}`, {
            code: "EMAIL_INVALID_PROXY",
        });
    }
    if (config.proxy.username) url.username = config.proxy.username;
    if (config.proxy.password) url.password = config.proxy.password;
    return url.toString();
}

function addressResults(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        if (typeof item === "string") return [item];
        if (isRecord(item) && typeof item.address === "string") return [item.address];
        return [];
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
