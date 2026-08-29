import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";
import SMTPPool from "nodemailer/lib/smtp-pool/index.js";
import SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { ImapFlow } from "imapflow";
import { EmailError } from "./errors.js";
import type { EmailConfig, EmailSendResult } from "./types.js";

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
    const security = config.imap.security || "tls";
    return new ImapFlow({
        host: config.imap.host,
        port: config.imap.port || (security === "tls" ? 993 : 143),
        secure: security === "tls",
        doSTARTTLS: security === "starttls" ? true : security === "plain" ? false : undefined,
        auth: {
            user: config.auth.user,
            pass: config.auth.password,
            accessToken: config.auth.access_token,
        },
        proxy: resolveProxyUrl(config),
        tls: { rejectUnauthorized: config.imap.reject_unauthorized !== false },
        connectionTimeout: config.imap.connection_timeout_ms,
        greetingTimeout: config.imap.greeting_timeout_ms,
        socketTimeout: config.imap.socket_timeout_ms,
        maxIdleTime: config.imap.max_idle_time_ms,
        logger: false,
    });
}

/** 校验运行时配置中无法由静态 Schema 表达的互斥条件。 */
export function validateEmailConfig(config: EmailConfig): void {
    if (!config.auth?.password && !config.auth?.access_token) {
        throw new EmailError("邮件认证必须配置 password 或 access_token", {
            code: "EMAIL_AUTH_REQUIRED",
        });
    }
    for (const [field, value] of [
        ["address", config.address],
        ["auth.user", config.auth?.user],
        ["smtp.host", config.smtp?.host],
        ["imap.host", config.imap?.host],
    ] as const) {
        if (!value?.trim()) {
            throw new EmailError(`${field} 不能为空`, { code: "EMAIL_CONFIG_INVALID" });
        }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.address)) {
        throw new EmailError("address 不是有效邮箱地址", { code: "EMAIL_CONFIG_INVALID" });
    }
    validateSecurity("smtp.security", config.smtp.security);
    validateSecurity("imap.security", config.imap.security);
    validatePort("smtp.port", config.smtp.port);
    validatePort("imap.port", config.imap.port);
    if (
        config.imap.retry_initial_delay_ms !== undefined &&
        config.imap.retry_max_delay_ms !== undefined &&
        config.imap.retry_initial_delay_ms > config.imap.retry_max_delay_ms
    ) {
        throw new EmailError("imap.retry_initial_delay_ms 不能大于 retry_max_delay_ms", {
            code: "EMAIL_CONFIG_INVALID",
        });
    }
    resolveProxyUrl(config);
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
    return config.auth.access_token
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
