export const notificationEvents = [
    { id: "gateway.failed", label: "网关故障" },
    { id: "generation.failed", label: "运行版本激活失败" },
    { id: "configuration.failed", label: "配置应用失败" },
    { id: "account.online", label: "账号首次上线" },
    { id: "account.recovered", label: "账号恢复在线" },
    { id: "account.offline", label: "账号离线" },
    { id: "account.disconnected", label: "账号网络连接中断" },
    { id: "account.brief-outage", label: "短暂离线后恢复" },
    { id: "login.interaction", label: "等待登录交互" },
] as const;
export type NotificationEventType = (typeof notificationEvents)[number]["id"];
interface BaseChannel {
    id: string;
    name: string;
    enabled: boolean;
    includeChallengeLink: boolean;
}
export type NotificationChannel =
    | (BaseChannel & {
          type: "webhook";
          url: string;
          allowPrivateNetwork: boolean;
          auth: { type: "none" | "bearer" | "hmac"; secret?: string };
      })
    | (BaseChannel & { type: "email"; smtpId: string; groupId: string })
    | (BaseChannel & {
          type: "bark";
          serverUrl: string;
          deviceKeys: string[];
          allowPrivateNetwork: boolean;
      });
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
    smtpProfiles: Array<{
        id: string;
        name: string;
        host: string;
        port: number;
        secure: boolean;
        username: string;
        password: string;
        from: string;
    }>;
    recipientGroups: Array<{ id: string; name: string; addresses: string[] }>;
    channels: NotificationChannel[];
    rules: NotificationRule[];
}
export interface NotificationDelivery {
    id: string;
    channelId: string;
    status: "pending" | "delivered" | "failed";
    attempts: number;
    createdAt: string;
    deliveredAt?: string;
    lastError?: string;
    events: Array<{
        type: NotificationEventType;
        title: string;
        summary: string;
        occurredAt: string;
    }>;
}
export interface NotificationSnapshot {
    config: NotificationConfig;
    deliveries: NotificationDelivery[];
    droppedDeliveries: number;
}

export function notificationStatusLabel(snapshot?: NotificationSnapshot): string {
    if (!snapshot) return "状态未知";
    const failed = snapshot.deliveries.filter(item => item.status === "failed").length;
    if (failed) return `${failed} 条失败`;
    if (snapshot.droppedDeliveries) return `${snapshot.droppedDeliveries} 条未排队`;
    const pending = snapshot.deliveries.filter(item => item.status === "pending").length;
    if (pending) return `${pending} 条待发送`;
    const enabledChannelIds = new Set(
        snapshot.config.channels.filter(channel => channel.enabled).map(channel => channel.id),
    );
    if (!enabledChannelIds.size) return "未设置";
    const hasEffectiveRule = snapshot.config.rules.some(
        rule =>
            rule.enabled &&
            rule.events.length > 0 &&
            rule.channelIds.some(id => enabledChannelIds.has(id)),
    );
    return hasEffectiveRule ? "已设置" : "待配置规则";
}

export function addChannel(type: NotificationChannel["type"]): NotificationChannel {
    const base = {
        id: crypto.randomUUID(),
        name: "新渠道",
        enabled: true,
        includeChallengeLink: false,
    };
    if (type === "webhook")
        return { ...base, type, url: "", allowPrivateNetwork: false, auth: { type: "none" } };
    if (type === "email") return { ...base, type, smtpId: "", groupId: "" };
    return {
        ...base,
        type,
        serverUrl: "https://api.day.app",
        deviceKeys: [""],
        allowPrivateNetwork: false,
        includeChallengeLink: true,
    };
}
