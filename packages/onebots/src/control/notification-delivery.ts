import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import nodemailer from "nodemailer";
import type { ControlVerificationChallenge } from "@onebots/core/control";
import type {
    BarkChannel,
    EmailChannel,
    NotificationConfig,
    NotificationEvent,
    SmtpProfile,
    WebhookChannel,
} from "./notification-types.js";

/** Bark 的批量接口可能 HTTP 200 但部分设备失败；自动重试会重复打扰已成功设备。 */
export class BarkPartialDeliveryError extends Error {}

const privateAddresses = new BlockList();
for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const)
    privateAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
    ["2001:db8::", 32],
] as const)
    privateAddresses.addSubnet(address, prefix, "ipv6");

export function validateTargetUrl(value: string, allowPrivateNetwork: boolean): URL {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error("通知目标 URL 无效");
    if (!allowPrivateNetwork && url.protocol !== "https:")
        throw new Error("公网通知目标必须使用 HTTPS");
    return url;
}

function isPrivate(address: string): boolean {
    const family = isIP(address);
    if (!family) return true;
    if (family === 6 && address.toLowerCase().startsWith("::ffff:"))
        return isPrivate(address.slice(7));
    return privateAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** DNS 校验与实际 socket 共用同一解析结果，避免检查后再次解析的竞态。 */
async function postJson(
    urlText: string,
    payload: object,
    headers: Record<string, string>,
    allowPrivateNetwork: boolean,
    readResponse = false,
): Promise<string | undefined> {
    const url = validateTargetUrl(urlText, allowPrivateNetwork);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await lookup(hostname, { all: true });
    if (
        !addresses.length ||
        (!allowPrivateNetwork && addresses.some(item => isPrivate(item.address)))
    )
        throw new Error("通知目标解析到内网、本机或保留地址");
    const chosen = addresses[0];
    const body = Buffer.from(JSON.stringify(payload));
    if (body.length > 1024 * 1024) throw new Error("通知报文过大");
    const transport = url.protocol === "https:" ? https : http;
    return new Promise<string | undefined>((resolve, reject) => {
        const request = transport.request(
            url,
            {
                method: "POST",
                agent: false,
                timeout: 10_000,
                lookup: (_host, options, callback) => {
                    if (options.all) callback(null, [chosen]);
                    else callback(null, chosen.address, chosen.family);
                },
                headers: {
                    "content-type": "application/json; charset=utf-8",
                    "content-length": String(body.length),
                    ...headers,
                },
            },
            response => {
                const chunks: Buffer[] = [];
                let size = 0;
                response.on("data", (chunk: Buffer) => {
                    if (!readResponse) return;
                    size += chunk.length;
                    if (size > 64 * 1024) response.destroy(new Error("通知目标回执过大"));
                    else chunks.push(chunk);
                });
                response.on("error", reject);
                response.on("end", () => {
                    if (
                        response.statusCode &&
                        response.statusCode >= 200 &&
                        response.statusCode < 300
                    )
                        resolve(readResponse ? Buffer.concat(chunks).toString("utf8") : undefined);
                    else reject(new Error(`通知目标返回 HTTP ${response.statusCode ?? "未知"}`));
                });
            },
        );
        request.on("timeout", () => request.destroy(new Error("通知目标响应超时")));
        request.on("error", reject);
        request.end(body);
    });
}

function challengeUrl(config: NotificationConfig, event: NotificationEvent): string | undefined {
    if (!event.challengeId || !config.externalUrl) return;
    const url = new URL(config.externalUrl);
    url.hash = "activity";
    return url.toString();
}

export async function deliverWebhook(
    channel: WebhookChannel,
    config: NotificationConfig,
    events: NotificationEvent[],
    challenge?: ControlVerificationChallenge,
): Promise<void> {
    const timestamp = String(Date.now());
    const event = summarize(events);
    const payload = {
        version: 1,
        event,
        events,
        ...(channel.includeChallengeLink ? { consoleUrl: challengeUrl(config, event) } : {}),
        ...(channel.includeChallengeLink && challenge
            ? { verification: verificationProjection(challenge) }
            : {}),
    };
    const text = JSON.stringify(payload);
    const headers: Record<string, string> = { "x-onebots-event": event.type };
    if (channel.auth.type === "bearer") headers.authorization = `Bearer ${channel.auth.secret}`;
    if (channel.auth.type === "hmac") {
        headers["x-onebots-timestamp"] = timestamp;
        headers["x-onebots-signature"] =
            `sha256=${createHmac("sha256", channel.auth.secret).update(`${timestamp}.${text}`).digest("hex")}`;
    }
    await postJson(channel.url, payload, headers, channel.allowPrivateNetwork);
}

export async function deliverBark(
    channel: BarkChannel,
    config: NotificationConfig,
    events: NotificationEvent[],
): Promise<void> {
    const event = summarize(events);
    const base = validateTargetUrl(channel.serverUrl, channel.allowPrivateNetwork);
    const url = new URL(`${base.pathname.replace(/\/$/, "")}/push`, base);
    const link = channel.includeChallengeLink ? challengeUrl(config, event) : undefined;
    const level =
        event.type === "account.online" || event.type === "account.recovered"
            ? "passive"
            : event.type === "login.interaction"
              ? "timeSensitive"
              : "active";
    const raw = await postJson(
        url.toString(),
        {
            device_keys: channel.deviceKeys,
            title: event.title,
            body: event.summary,
            group: "OneBots",
            level,
            ...(link ? { url: link } : {}),
        },
        {},
        channel.allowPrivateNetwork,
        true,
    );
    let response: unknown;
    try {
        response = JSON.parse(raw ?? "");
    } catch {
        throw new Error("Bark 回执格式无效");
    }
    if (!response || typeof response !== "object" || Array.isArray(response))
        throw new Error("Bark 回执格式无效");
    const result = response as { code?: unknown; data?: unknown };
    if (result.code !== 200) throw new Error("Bark 服务拒绝推送");
    if (!Array.isArray(result.data) || result.data.length !== channel.deviceKeys.length)
        throw new Error("Bark 批量回执不完整");
    const failed = result.data.filter(item => !item || typeof item !== "object" || item.code !== 200);
    if (failed.length === channel.deviceKeys.length)
        throw new Error("Bark 服务拒绝全部设备 Key，请确认设备已在当前服务注册");
    if (failed.length)
        throw new BarkPartialDeliveryError("Bark 部分设备推送失败，已停止自动重试");
}

export async function deliverEmail(
    channel: EmailChannel,
    config: NotificationConfig,
    events: NotificationEvent[],
    challenge?: ControlVerificationChallenge,
): Promise<void> {
    const event = summarize(events);
    const profile: SmtpProfile | undefined = config.smtpProfiles.find(
        item => item.id === channel.smtpId,
    );
    const group = config.recipientGroups.find(item => item.id === channel.groupId);
    if (!profile || !group?.addresses.length) throw new Error("邮件发件配置或收件组不存在");
    const transport = nodemailer.createTransport({
        host: profile.host,
        port: profile.port,
        secure: profile.secure,
        auth: profile.username ? { user: profile.username, pass: profile.password } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
    });
    try {
        const link = channel.includeChallengeLink ? challengeUrl(config, event) : undefined;
        const blocks =
            channel.includeChallengeLink && challenge
                ? verificationProjection(challenge).blocks
                : [];
        const urls = blocks.flatMap(block => {
            if (block.type === "link" || block.type === "image_url") return [block.url];
            if (block.type === "qrcode" && /^https:\/\//.test(block.content))
                return [block.content];
            return [];
        });
        const image = blocks.find(block => block.type === "image");
        const inlineImage =
            image?.type === "image"
                ? image.base64.replace(/^data:image\/[^;]+;base64,/, "")
                : undefined;
        await transport.sendMail({
            from: profile.from,
            to: group.addresses.join(", "),
            subject: `[OneBots] ${event.title}`,
            text: `${event.summary}\n发生时间：${event.occurredAt}${urls.map(url => `\n平台验证链接：${url}`).join("")}${link ? `\n管理台：${link}` : ""}${inlineImage ? "\n二维码见附件。" : ""}`,
            ...(inlineImage
                ? {
                      attachments: [
                          {
                              filename: "verification-qr.png",
                              content: Buffer.from(inlineImage, "base64"),
                              contentType: "image/png",
                          },
                      ],
                  }
                : {}),
        });
    } finally {
        transport.close();
    }
}

/** 仅取验证展示材料；输入控件、答案和适配器私有 data 一律不外发。 */
function verificationProjection(challenge: ControlVerificationChallenge) {
    const blocks = (challenge.request.options?.blocks ?? []).filter(block =>
        ["image", "image_url", "qrcode", "link"].includes(block.type),
    );
    return { type: challenge.request.type, hint: challenge.request.hint, blocks };
}

function summarize(events: NotificationEvent[]): NotificationEvent {
    const first = events[0];
    if (events.length === 1) return first;
    const mixed = events.some(item => item.type !== first.type);
    return {
        ...first,
        title: mixed ? `${events.length} 个账号状态变化` : `${events.length} 个账号${first.title}`,
        summary: events
            .map(
                item =>
                    `${item.account?.platform ?? "服务"}/${item.account?.accountId ?? "管理"}：${item.summary}`,
            )
            .join("\n"),
        account: undefined,
    };
}
