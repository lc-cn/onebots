import { AdapterRegistry, type Schema } from "onebots";

export { EmailAdapter } from "./adapter.js";
export { emailCapabilities } from "./capabilities.js";
export { EmailClient, type EmailClientEvents, type EmailClientOptions } from "./client.js";
export { EmailError, type EmailErrorOptions } from "./errors.js";
export { parseEmailSource, projectEmailEvent, type EmailProjectionContext } from "./events.js";
export { compileEmailMessage, createEmailSendOptions, type CompiledEmail } from "./messages.js";
export { createImapMessageId, parseImapMessageId, type ImapMessageLocation } from "./message-id.js";
export { EMAIL_PLATFORM_ACTIONS, executeEmailPlatformAction } from "./platform-actions.js";
export type { EmailSmtpTransport } from "./transports.js";
export type * from "./types.js";

const securityChoices = [
    { value: "tls", label: "直接 TLS" },
    { value: "starttls", label: "STARTTLS" },
    { value: "plain", label: "明文（不推荐）" },
];

const emailSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部使用的稳定账号 ID",
        ui: { section: "credentials" },
    },
    address: {
        type: "string",
        required: true,
        label: "邮箱地址",
        placeholder: "bot@example.com",
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        ui: { section: "credentials" },
    },
    display_name: {
        type: "string",
        label: "发件人名称",
        ui: { section: "delivery" },
    },
    default_subject: {
        type: "string",
        label: "默认主题",
        description: "消息没有 email.subject 段时使用",
        ui: { section: "delivery" },
    },
    auth: {
        user: {
            type: "string",
            required: true,
            label: "登录用户名",
            description: "SMTP 与 IMAP 共用；通常为完整邮箱地址",
            ui: { section: "credentials" },
        },
        password: {
            type: "string",
            label: "密码或应用专用密码",
            sensitive: true,
            description: "password 与 access_token 至少填写一项",
            ui: { section: "credentials" },
        },
        access_token: {
            type: "string",
            label: "OAuth2 Access Token",
            sensitive: true,
            description: "配置后 SMTP 与 IMAP 均优先使用 OAuth2",
            ui: { section: "credentials" },
        },
    },
    smtp: {
        host: {
            type: "string",
            required: true,
            label: "SMTP 主机",
            placeholder: "smtp.example.com",
            ui: { section: "transport" },
        },
        port: {
            type: "number",
            min: 1,
            max: 65535,
            label: "SMTP 端口",
            ui: { section: "transport" },
        },
        security: {
            type: "string",
            default: "starttls",
            label: "SMTP 加密方式",
            choices: securityChoices,
            ui: { section: "transport" },
        },
        pool: { type: "boolean", default: true, label: "启用连接池", ui: { section: "delivery" } },
        max_connections: {
            type: "number",
            min: 1,
            default: 5,
            label: "最大 SMTP 连接数",
            ui: { section: "advanced" },
        },
        max_messages: {
            type: "number",
            min: 1,
            default: 100,
            label: "单连接最大邮件数",
            ui: { section: "advanced" },
        },
        reject_unauthorized: {
            type: "boolean",
            default: true,
            label: "校验 SMTP TLS 证书",
            ui: { section: "advanced" },
        },
        connection_timeout_ms: {
            type: "number",
            min: 1,
            label: "SMTP 连接超时（毫秒）",
            ui: { section: "advanced" },
        },
        greeting_timeout_ms: {
            type: "number",
            min: 1,
            label: "SMTP 欢迎超时（毫秒）",
            ui: { section: "advanced" },
        },
        socket_timeout_ms: {
            type: "number",
            min: 1,
            label: "SMTP Socket 超时（毫秒）",
            ui: { section: "advanced" },
        },
    },
    imap: {
        host: {
            type: "string",
            required: true,
            label: "IMAP 主机",
            placeholder: "imap.example.com",
            ui: { section: "transport" },
        },
        port: {
            type: "number",
            min: 1,
            max: 65535,
            label: "IMAP 端口",
            ui: { section: "transport" },
        },
        security: {
            type: "string",
            default: "tls",
            label: "IMAP 加密方式",
            choices: securityChoices,
            ui: { section: "transport" },
        },
        mailbox: { type: "string", default: "INBOX", label: "接收目录", ui: { section: "filter" } },
        mark_seen: {
            type: "boolean",
            default: true,
            label: "投影成功后标为已读",
            ui: { section: "delivery" },
        },
        poll_interval_ms: {
            type: "number",
            min: 0,
            default: 60000,
            label: "IDLE 兜底轮询（毫秒）",
            description: "设为 0 关闭兜底轮询；实时事件仍由 IMAP IDLE 驱动",
            ui: { section: "advanced" },
        },
        retry_initial_delay_ms: {
            type: "number",
            min: 100,
            default: 1000,
            label: "初始重连延迟（毫秒）",
            ui: { section: "advanced" },
        },
        retry_max_delay_ms: {
            type: "number",
            min: 1000,
            default: 30000,
            label: "最大重连延迟（毫秒）",
            ui: { section: "advanced" },
        },
        reject_unauthorized: {
            type: "boolean",
            default: true,
            label: "校验 IMAP TLS 证书",
            ui: { section: "advanced" },
        },
        connection_timeout_ms: {
            type: "number",
            min: 1,
            label: "IMAP 连接超时（毫秒）",
            ui: { section: "advanced" },
        },
        greeting_timeout_ms: {
            type: "number",
            min: 1,
            label: "IMAP 欢迎超时（毫秒）",
            ui: { section: "advanced" },
        },
        socket_timeout_ms: {
            type: "number",
            min: 1,
            label: "IMAP Socket 超时（毫秒）",
            ui: { section: "advanced" },
        },
        max_idle_time_ms: {
            type: "number",
            min: 1000,
            label: "单次 IDLE 最长时间（毫秒）",
            ui: { section: "advanced" },
        },
    },
    proxy: {
        url: {
            type: "string",
            label: "SMTP/IMAP 代理地址",
            placeholder: "socks5://127.0.0.1:1080",
            description: "支持 HTTP、HTTPS、SOCKS4 与 SOCKS5",
            ui: { section: "advanced" },
        },
        username: { type: "string", label: "代理用户名", ui: { section: "advanced" } },
        password: {
            type: "string",
            label: "代理密码",
            sensitive: true,
            ui: { section: "advanced" },
        },
    },
};

AdapterRegistry.registerSchema("email", emailSchema);
