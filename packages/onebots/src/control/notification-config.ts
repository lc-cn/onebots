import { z } from "zod";
import { notificationEventTypes, type NotificationConfig } from "./notification-types.js";
import { validateTargetUrl } from "./notification-delivery.js";

const id = z.string().uuid();
const name = z.string().trim().min(1).max(80);
const text = z.string().trim().min(1).max(2048);
const base = { id, name, enabled: z.boolean(), includeChallengeLink: z.boolean() };
const webhook = z.strictObject({
    ...base,
    type: z.literal("webhook"),
    url: text,
    allowPrivateNetwork: z.boolean(),
    auth: z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("none") }),
        z.strictObject({ type: z.literal("bearer"), secret: z.string().max(4096) }),
        z.strictObject({ type: z.literal("hmac"), secret: z.string().max(4096) }),
    ]),
});
const email = z.strictObject({ ...base, type: z.literal("email"), smtpId: id, groupId: id });
const bark = z.strictObject({
    ...base,
    type: z.literal("bark"),
    serverUrl: text,
    deviceKeys: z.array(z.string().trim().min(1).max(256)).min(1).max(50),
    allowPrivateNetwork: z.boolean(),
});
const schema = z.strictObject({
    schemaVersion: z.literal(1),
    externalUrl: z.string().max(2048),
    smtpProfiles: z
        .array(
            z.strictObject({
                id,
                name,
                host: z.string().trim().min(1).max(253),
                port: z.number().int().min(1).max(65535),
                secure: z.boolean(),
                username: z.string().max(512),
                password: z.string().max(4096),
                from: z.email(),
            }),
        )
        .max(50),
    recipientGroups: z
        .array(
            z.strictObject({
                id,
                name,
                addresses: z.array(z.email()).min(1).max(100),
            }),
        )
        .max(100),
    channels: z.array(z.discriminatedUnion("type", [webhook, email, bark])).max(100),
    rules: z
        .array(
            z.strictObject({
                id,
                name,
                enabled: z.boolean(),
                events: z
                    .array(z.enum(notificationEventTypes))
                    .min(1)
                    .max(notificationEventTypes.length),
                accounts: z.union([
                    z.literal("all"),
                    z.array(z.string().trim().min(3).max(256)).max(1000),
                ]),
                channelIds: z.array(id).max(100),
            }),
        )
        .max(100),
});

export function emptyNotificationConfig(): NotificationConfig {
    return {
        schemaVersion: 1,
        externalUrl: "",
        smtpProfiles: [],
        recipientGroups: [],
        channels: [],
        rules: [],
    };
}

/** 修改密钥时空字符串表示保留；读取接口只提供掩码，不回传可用凭据。 */
export function publicNotificationConfig(config: NotificationConfig): NotificationConfig {
    return {
        ...config,
        smtpProfiles: config.smtpProfiles.map(item => ({
            ...item,
            password: item.password ? "••••" : "",
        })),
        channels: config.channels.map(channel =>
            channel.type === "bark"
                ? {
                      ...channel,
                      deviceKeys: channel.deviceKeys.map((_key, index) => `••••:${index}`),
                  }
                : channel.type === "webhook" && channel.auth.type !== "none"
                  ? {
                        ...channel,
                        auth: { ...channel.auth, secret: channel.auth.secret ? "••••" : "" },
                    }
                  : { ...channel },
        ),
    };
}

export function parseNotificationConfig(
    input: unknown,
    previous?: NotificationConfig,
): NotificationConfig {
    const parsed = schema.parse(input) as NotificationConfig;
    const next: NotificationConfig = {
        ...parsed,
        smtpProfiles: parsed.smtpProfiles.map(profile => ({
            ...profile,
            password:
                profile.password === "••••" || profile.password === ""
                    ? (previous?.smtpProfiles.find(item => item.id === profile.id)?.password ?? "")
                    : profile.password,
        })),
        channels: parsed.channels.map(channel => {
            const prior = previous?.channels.find(
                item => item.id === channel.id && item.type === channel.type,
            );
            if (channel.type === "bark")
                return {
                    ...channel,
                    deviceKeys: channel.deviceKeys.map(key =>
                        /^••••:\d+$/.test(key) && prior?.type === "bark"
                            ? (prior.deviceKeys[Number(key.slice(5))] ?? "")
                            : key,
                    ),
                };
            if (channel.type === "webhook" && channel.auth.type !== "none")
                return {
                    ...channel,
                    auth: {
                        ...channel.auth,
                        secret:
                            channel.auth.secret === "••••" || channel.auth.secret === ""
                                ? prior?.type === "webhook" && prior.auth.type === channel.auth.type
                                    ? prior.auth.secret
                                    : ""
                                : channel.auth.secret,
                    },
                };
            return channel;
        }),
    };
    for (const collection of [next.smtpProfiles, next.recipientGroups, next.channels, next.rules])
        if (new Set(collection.map(item => item.id)).size !== collection.length)
            throw new Error("通知配置 ID 重复");
    if (next.externalUrl) {
        const url = new URL(next.externalUrl);
        if (url.protocol !== "https:" || url.username || url.password || url.hash)
            throw new Error("管理台外部 URL 必须是 HTTPS 地址");
    }
    for (const channel of next.channels) {
        if (
            channel.type === "email" &&
            (!next.smtpProfiles.some(item => item.id === channel.smtpId) ||
                !next.recipientGroups.some(item => item.id === channel.groupId))
        )
            throw new Error(`邮件渠道 ${channel.name} 缺少发件配置或收件组`);
        if (channel.type === "webhook") {
            validateTargetUrl(channel.url, channel.allowPrivateNetwork);
            if (channel.auth.type !== "none" && !channel.auth.secret)
                throw new Error(`Webhook 渠道 ${channel.name} 缺少认证密钥`);
        }
        if (channel.type === "bark") {
            validateTargetUrl(channel.serverUrl, channel.allowPrivateNetwork);
            if (channel.deviceKeys.some(key => !key || key.startsWith("••••:")))
                throw new Error(`Bark 渠道 ${channel.name} 缺少设备 Key`);
        }
    }
    for (const rule of next.rules) {
        if (rule.channelIds.some(channelId => !next.channels.some(item => item.id === channelId)))
            throw new Error(`规则 ${rule.name} 引用了不存在的渠道`);
        if (
            rule.enabled &&
            rule.events.includes("login.interaction") &&
            !next.externalUrl &&
            rule.channelIds.some(channelId =>
                next.channels.some(
                    item => item.id === channelId && item.type === "bark" && item.enabled,
                ),
            )
        )
            throw new Error("启用 Bark 登录交互通知前，必须配置管理台外部访问 URL");
        if (
            rule.enabled &&
            rule.events.includes("login.interaction") &&
            rule.channelIds.some(channelId =>
                next.channels.some(
                    item =>
                        item.id === channelId &&
                        item.type === "bark" &&
                        item.enabled &&
                        !item.includeChallengeLink,
                ),
            )
        )
            throw new Error("Bark 登录交互通知必须附带受保护的管理台链接");
    }
    return next;
}
