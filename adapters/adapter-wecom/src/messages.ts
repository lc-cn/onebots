import type { CommonTypes } from "onebots";
import { WeComApiError } from "./errors.js";
import { weComMediaType } from "./media.js";

export interface WeComOutboundMessage extends Record<string, unknown> {
    msgtype: string;
}

/** 将通用消息段编译为顺序明确的企业微信原生消息。 */
export function compileWeComMessages(
    input: ReadonlyArray<CommonTypes.Segment | string>,
    resolveUserId: (value: string | number) => string = value => String(value),
): WeComOutboundMessage[] {
    const messages: WeComOutboundMessage[] = [];
    let text = "";
    const flushText = (): void => {
        if (!text) return;
        messages.push({ msgtype: "text", text: { content: text } });
        text = "";
    };
    for (const segment of input) {
        if (typeof segment === "string") {
            text += segment;
            continue;
        }
        if (segment.type === "text") {
            text += stringValue(segment.data.text) || "";
            continue;
        }
        if (segment.type === "at") {
            const user = identifierValue(
                segment.data.user_id ?? segment.data.id ?? segment.data.qq,
            );
            if (user === undefined) invalid("at 段必须提供 user_id");
            // 自建应用与 appchat 没有独立的提及字段，只能保留可读文本。
            text += `@${resolveUserId(user)}`;
            continue;
        }
        flushText();
        if (segment.type === "wecom_message") {
            messages.push(nativeMessage(segment.data));
            continue;
        }
        if (segment.type === "markdown") {
            const content = stringValue(segment.data.content) || stringValue(segment.data.text);
            if (!content) invalid("markdown 段必须提供 content");
            messages.push({ msgtype: "markdown", markdown: { content } });
            continue;
        }
        const mediaType = weComMediaType(segment.type);
        if (mediaType) {
            const mediaId =
                stringValue(segment.data.media_id) || mediaIdFromFile(segment.data.file);
            if (!mediaId) invalid(`${segment.type} 段必须提供 media_id 或 wecom://media/{id}`);
            messages.push(mediaMessage(mediaType, mediaId, segment.data));
            continue;
        }
        invalid(`不支持消息段 ${segment.type}`);
    }
    flushText();
    if (messages.length === 0) invalid("消息内容不能为空");
    return messages;
}

function nativeMessage(data: Record<string, unknown>): WeComOutboundMessage {
    const value = data.message || data;
    if (!isRecord(value) || typeof value.msgtype !== "string" || !value.msgtype)
        invalid("wecom_message 段必须提供含 msgtype 的 message 对象");
    const message = structuredClone(value) as WeComOutboundMessage;
    delete message.touser;
    delete message.toparty;
    delete message.totag;
    delete message.chatid;
    delete message.agentid;
    return message;
}

function mediaMessage(
    type: "image" | "voice" | "video" | "file",
    mediaId: string,
    data: Record<string, unknown>,
): WeComOutboundMessage {
    if (type !== "video") return { msgtype: type, [type]: { media_id: mediaId } };
    return {
        msgtype: "video",
        video: {
            media_id: mediaId,
            title: stringValue(data.title),
            description: stringValue(data.description),
        },
    };
}

function mediaIdFromFile(value: unknown): string | undefined {
    const file = stringValue(value);
    if (!file) return undefined;
    if (file.startsWith("wecom://media/")) return file.slice("wecom://media/".length) || undefined;
    return /^[\w-]+$/u.test(file) ? file : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function identifierValue(value: unknown): string | number | undefined {
    return (typeof value === "string" && value) || typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WeComApiError(`企业微信 ${message}`, { code: "WECOM_INVALID_MESSAGE" });
}
