/** 管理服务的通知契约；不属于网关 config.yaml，也不由协议插件解释。 */
export const notificationEventTypes = [
    "gateway.failed",
    "generation.failed",
    "configuration.failed",
    "account.online",
    "account.recovered",
    "account.offline",
    "account.disconnected",
    "account.brief-outage",
    "login.interaction",
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];

export function notificationTypeForOperation(action: string): NotificationEventType | undefined {
    if (action === "generation.activate") return "generation.failed";
    if (action.startsWith("configuration.")) return "configuration.failed";
    if (["start", "restart", "shutdown"].includes(action)) return "gateway.failed";
}

export interface NotificationEvent {
    id: string;
    type: NotificationEventType;
    occurredAt: string;
    title: string;
    summary: string;
    account?: { platform: string; accountId: string };
    durationMs?: number;
    /** 只保存挑战 ID；二维码、验证码及平台令牌绝不进入投递队列。 */
    challengeId?: string;
}

interface ChannelBase {
    id: string;
    name: string;
    enabled: boolean;
    includeChallengeLink: boolean;
}

export interface WebhookChannel extends ChannelBase {
    type: "webhook";
    url: string;
    allowPrivateNetwork: boolean;
    auth: { type: "none" } | { type: "bearer" | "hmac"; secret: string };
}

export interface EmailChannel extends ChannelBase {
    type: "email";
    smtpId: string;
    groupId: string;
}

export interface BarkChannel extends ChannelBase {
    type: "bark";
    serverUrl: string;
    deviceKeys: string[];
    allowPrivateNetwork: boolean;
}

export type NotificationChannel = WebhookChannel | EmailChannel | BarkChannel;

export interface SmtpProfile {
    id: string;
    name: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
}

export interface RecipientGroup {
    id: string;
    name: string;
    addresses: string[];
}

export interface NotificationRule {
    id: string;
    name: string;
    enabled: boolean;
    events: NotificationEventType[];
    accounts: "all" | string[];
    channelIds: string[];
}

export interface NotificationConfig {
    schemaVersion: 1;
    externalUrl: string;
    smtpProfiles: SmtpProfile[];
    recipientGroups: RecipientGroup[];
    channels: NotificationChannel[];
    rules: NotificationRule[];
}

export interface NotificationDelivery {
    id: string;
    channelId: string;
    events: NotificationEvent[];
    status: "pending" | "delivered" | "failed";
    attempts: number;
    nextAttemptAt: string;
    createdAt: string;
    deliveredAt?: string;
    lastError?: string;
}
