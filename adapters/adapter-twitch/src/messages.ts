import type { CommonTypes } from "onebots";
import { TwitchError } from "./errors.js";
import { isRecord } from "./validation.js";

export interface CompiledTwitchMessage {
    text: string;
    replyParentMessageId?: string;
}

/** Twitch Send Chat Message 只接受文本；在不伪造媒体能力的前提下编译原生 mention/emote/reply。 */
export function compileTwitchMessage(
    segments: readonly CommonTypes.Segment[],
): CompiledTwitchMessage {
    if (!segments.length) throw TwitchError.invalid("Twitch 消息不能为空");
    const content: string[] = [];
    let replyParentMessageId: string | undefined;
    for (const segment of segments) {
        if (!isRecord(segment.data)) throw TwitchError.invalid("Twitch 消息段 data 必须是对象");
        if (segment.type === "text") {
            content.push(requiredText(segment.data.text, "text.text"));
            continue;
        }
        if (segment.type === "at") {
            const login = stringValue(segment.data.login) || stringValue(segment.data.name);
            if (!login) throw TwitchError.invalid("Twitch @mention 必须提供 login 或 name");
            content.push(`@${login.replace(/^@/u, "")}`);
            continue;
        }
        if (segment.type === "emoji") {
            const text = stringValue(segment.data.text) || stringValue(segment.data.name);
            if (!text) throw TwitchError.invalid("Twitch emoji 必须提供可发送的 text/name");
            content.push(text);
            continue;
        }
        if (segment.type === "reply") {
            replyParentMessageId = requiredText(
                segment.data.message_id ?? segment.data.id,
                "reply.message_id",
            );
            continue;
        }
        if (["image", "video", "audio", "file"].includes(segment.type)) {
            const url = stringValue(segment.data.url) || stringValue(segment.data.file);
            if (!url)
                throw new TwitchError(
                    `Twitch Chat 不支持直接上传 ${segment.type}；请提供公开 URL`,
                    { code: "TWITCH_MEDIA_URL_REQUIRED" },
                );
            content.push(assertHttpUrl(url, `${segment.type}.url`));
            continue;
        }
        throw new TwitchError(`Twitch 不支持消息段 ${segment.type}`, {
            code: "TWITCH_UNSUPPORTED_SEGMENT",
        });
    }
    const text = content.join("");
    if (!text) throw TwitchError.invalid("Twitch 消息没有可发送内容");
    if ([...text].length > 500)
        throw TwitchError.invalid("Twitch Chat 消息不能超过 500 个 Unicode 字符");
    return { text, replyParentMessageId };
}

/** 保留 EventSub chat fragments 中的 mention、emote、cheermote 与 gif 结构。 */
export function projectTwitchFragments(message: unknown): CommonTypes.Segment[] {
    if (!isRecord(message)) return [{ type: "text", data: { text: "" } }];
    const fragments = Array.isArray(message.fragments) ? message.fragments : [];
    const projected: CommonTypes.Segment[] = [];
    for (const raw of fragments) {
        if (!isRecord(raw) || typeof raw.type !== "string" || typeof raw.text !== "string")
            continue;
        if (raw.type === "mention" && isRecord(raw.mention)) {
            projected.push({
                type: "at",
                data: {
                    text: raw.text,
                    user_id: stringValue(raw.mention.user_id),
                    login: stringValue(raw.mention.user_login),
                    name: stringValue(raw.mention.user_name),
                },
            });
            continue;
        }
        if (raw.type === "emote" && isRecord(raw.emote)) {
            const id = stringValue(raw.emote.id);
            projected.push({
                type: "emoji",
                data: {
                    text: raw.text,
                    id,
                    emote_set_id: stringValue(raw.emote.emote_set_id),
                    owner_id: stringValue(raw.emote.owner_id),
                    format: raw.emote.format,
                    url: id
                        ? `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/3.0`
                        : undefined,
                },
            });
            continue;
        }
        if (raw.type === "gif" && isRecord(raw.gif)) {
            projected.push({
                type: "image",
                data: {
                    text: raw.text,
                    id: stringValue(raw.gif.id),
                    url: stringValue(raw.gif.url),
                },
            });
            continue;
        }
        if (raw.type === "cheermote" && isRecord(raw.cheermote)) {
            projected.push({
                type: "emoji",
                data: {
                    text: raw.text,
                    prefix: stringValue(raw.cheermote.prefix),
                    bits: numberValue(raw.cheermote.bits),
                    tier: numberValue(raw.cheermote.tier),
                    cheermote: true,
                },
            });
            continue;
        }
        projected.push({ type: "text", data: { text: raw.text } });
    }
    if (!projected.length && typeof message.text === "string") {
        projected.push({ type: "text", data: { text: message.text } });
    }
    return projected.length ? projected : [{ type: "text", data: { text: "" } }];
}

function requiredText(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) throw TwitchError.invalid(`${field} 必须是非空字符串`);
    return value;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assertHttpUrl(value: string, field: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw TwitchError.invalid(`${field} 不是有效 URL`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
        throw TwitchError.invalid(`${field} 必须使用 HTTP 或 HTTPS`);
    return url.href;
}
