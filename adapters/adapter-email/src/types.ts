/** 邮件服务认证。密码与 OAuth2 access token 至少配置一项。 */
export interface EmailAuthConfig {
    user: string;
    password?: string;
    access_token?: string;
}

/** SMTP 与 IMAP 共用的代理配置。 */
export interface EmailProxyConfig {
    url: string;
    username?: string;
    password?: string;
}

export type EmailConnectionSecurity = "tls" | "starttls" | "plain";

/** SMTP 发送配置。 */
export interface EmailSmtpConfig {
    host: string;
    port?: number;
    security?: EmailConnectionSecurity;
    /** 默认校验证书；仅明确接入自签名服务时关闭。 */
    reject_unauthorized?: boolean;
    pool?: boolean;
    max_connections?: number;
    max_messages?: number;
    connection_timeout_ms?: number;
    greeting_timeout_ms?: number;
    socket_timeout_ms?: number;
}

/** IMAP 接收配置。 */
export interface EmailImapConfig {
    host: string;
    port?: number;
    security?: EmailConnectionSecurity;
    /** 默认校验证书；仅明确接入自签名服务时关闭。 */
    reject_unauthorized?: boolean;
    mailbox?: string;
    mark_seen?: boolean;
    poll_interval_ms?: number;
    retry_initial_delay_ms?: number;
    retry_max_delay_ms?: number;
    connection_timeout_ms?: number;
    greeting_timeout_ms?: number;
    socket_timeout_ms?: number;
    max_idle_time_ms?: number;
}

/** 邮件适配器配置。字段使用统一 snake_case，不保留旧 camelCase 别名。 */
export interface EmailConfig {
    account_id: string;
    address: string;
    display_name?: string;
    auth: EmailAuthConfig;
    proxy?: EmailProxyConfig;
    smtp: EmailSmtpConfig;
    imap: EmailImapConfig;
    default_subject?: string;
}

export interface EmailAddress {
    address: string;
    name?: string;
}

export interface EmailAttachment {
    filename: string;
    content_type: string;
    content: Buffer;
    size: number;
    checksum?: string;
    content_id?: string;
    disposition?: string;
    related?: boolean;
}

/** 已由 MailParser 解析的原生邮件。 */
export interface EmailMessage {
    uid: number;
    mailbox: string;
    id: string;
    subject: string;
    from: EmailAddress;
    to: EmailAddress[];
    cc?: EmailAddress[];
    bcc?: EmailAddress[];
    reply_to?: EmailAddress[];
    html?: string;
    text?: string;
    attachments?: EmailAttachment[];
    date: Date;
    in_reply_to?: string;
    references?: string[];
    headers: ReadonlyMap<string, unknown>;
}

export interface EmailOutgoingAttachment {
    filename: string;
    content?: Buffer | string;
    path?: string;
    href?: string;
    content_type?: string;
    cid?: string;
    disposition?: "attachment" | "inline";
}

/** 完整邮件发送参数，供平台动作与标准消息编译共用。 */
export interface EmailSendOptions {
    to: string | readonly string[];
    cc?: string | readonly string[];
    bcc?: string | readonly string[];
    reply_to?: string | readonly string[];
    subject: string;
    text?: string;
    html?: string;
    attachments?: EmailOutgoingAttachment[];
    in_reply_to?: string;
    references?: readonly string[];
    priority?: "high" | "normal" | "low";
    headers?: Readonly<Record<string, string>>;
}

export interface EmailSendResult {
    message_id: string;
    accepted: string[];
    rejected: string[];
    response: string;
}
