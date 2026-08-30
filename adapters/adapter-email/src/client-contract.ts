import type { ImapFlow } from "imapflow";
import type { EmailError } from "./errors.js";
import type { EmailSmtpTransport } from "./transports.js";
import type { EmailMessage } from "./types.js";

/** EmailClient 的完整事件签名。 */
export interface EmailClientEvents {
    ready: [];
    stop: [];
    connected: [];
    disconnected: [error: EmailError];
    email: [email: EmailMessage];
    raw_email: [email: EmailMessage];
    client_error: [error: EmailError];
}

/** 可替换的传输与计时依赖，供独立宿主和确定性测试注入。 */
export interface EmailClientOptions {
    createSmtp?: () => EmailSmtpTransport;
    createImap?: () => ImapFlow;
    sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}
