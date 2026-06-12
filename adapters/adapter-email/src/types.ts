/**
 * 邮件适配器类型定义
 */

/**
 * 代理配置
 */
export interface ProxyConfig {
    /** 代理服务器地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
    url: string;
    /** 代理用户名（可选） */
    username?: string;
    /** 代理密码（可选） */
    password?: string;
}

/**
 * SMTP 配置（发送邮件）
 */
export interface SMTPConfig {
    /** SMTP 服务器地址 */
    host: string;
    /** SMTP 端口，默认 587 */
    port?: number;
    /** 是否使用 TLS，默认 true */
    secure?: boolean;
    /** 是否使用 STARTTLS，默认 true */
    requireTLS?: boolean;
    /** 用户名（通常是邮箱地址） */
    user: string;
    /** 密码或应用专用密码 */
    password: string;
    /** 代理配置（可选） */
    proxy?: ProxyConfig;
}

/**
 * IMAP 配置（接收邮件）
 */
export interface IMAPConfig {
    /** IMAP 服务器地址 */
    host: string;
    /** IMAP 端口，默认 993 */
    port?: number;
    /** 是否使用 TLS，默认 true */
    tls?: boolean;
    /** 用户名（通常是邮箱地址） */
    user: string;
    /** 密码或应用专用密码 */
    password: string;
    /** 代理配置（可选） */
    proxy?: ProxyConfig;
    /** 轮询间隔（毫秒），默认 30000（30秒） */
    pollInterval?: number;
    /** 监听的邮箱文件夹，默认 'INBOX' */
    mailbox?: string;
}

/**
 * 邮件适配器配置
 */
export interface EmailConfig {
    account_id: string;
    /** 发件人邮箱地址 */
    from: string;
    /** 发件人显示名称（可选） */
    fromName?: string;
    /** SMTP 配置（发送邮件） */
    smtp: SMTPConfig;
    /** IMAP 配置（接收邮件） */
    imap: IMAPConfig;
}

/**
 * 邮件消息类型
 */
export interface EmailMessage {
    /** 邮件 ID */
    id: string;
    /** 主题 */
    subject: string;
    /** 发件人 */
    from: {
        address: string;
        name?: string;
    };
    /** 收件人列表 */
    to: Array<{
        address: string;
        name?: string;
    }>;
    /** 抄送列表 */
    cc?: Array<{
        address: string;
        name?: string;
    }>;
    /** 密送列表 */
    bcc?: Array<{
        address: string;
        name?: string;
    }>;
    /** 邮件正文（HTML） */
    html?: string;
    /** 邮件正文（纯文本） */
    text?: string;
    /** 附件列表 */
    attachments?: Array<{
        filename: string;
        contentType: string;
        content: Buffer;
    }>;
    /** 发送时间 */
    date: Date;
    /** 回复的邮件 ID（如果有） */
    inReplyTo?: string;
    /** 引用的邮件 ID（如果有） */
    references?: string[];
}

/**
 * nodemailer SMTP 传输器配置
 * 由于 nodemailer 未提供 TypeScript 类型，手动定义关键字段
 */
export interface SmtpTransportOptions {
    host: string;
    port?: number;
    secure?: boolean;
    requireTLS?: boolean;
    auth?: {
        user: string;
        pass: string;
    };
    /** HTTPS/SOCKS 代理 agent */
    agent?: unknown;
    [key: string]: unknown;
}

