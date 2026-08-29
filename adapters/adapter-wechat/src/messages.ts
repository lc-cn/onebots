import type { CommonTypes } from "onebots";
import { WechatApiError } from "./errors.js";
import type { WechatOutboundMessage } from "./types.js";

export interface CompiledWechatMessages {
    messages: WechatOutboundMessage[];
    replyEventId?: string;
}

/** 将通用消息段编译为微信公众号客服消息；不把媒体 URL 降级成占位文本。 */
export function compileWechatMessages(
    input: ReadonlyArray<CommonTypes.Segment | string>,
): CompiledWechatMessages {
    const messages: WechatOutboundMessage[] = [];
    let replyEventId: string | undefined;
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
        if (segment.type === "reply") {
            const eventId =
                stringValue(segment.data.event_id) ||
                stringValue(segment.data.message_id) ||
                stringValue(segment.data.id);
            if (!eventId) invalid("reply 段必须提供 event_id 或 message_id");
            if (replyEventId && replyEventId !== eventId) invalid("一条消息不能回复多个入站事件");
            replyEventId = eventId;
            continue;
        }
        flushText();
        if (segment.type === "wechat_message") {
            messages.push(nativeMessage(segment.data));
            continue;
        }
        const mediaType = mediaMessageType(segment.type);
        if (mediaType) {
            const mediaId =
                stringValue(segment.data.media_id) || mediaIdFromFile(segment.data.file);
            if (!mediaId) {
                invalid(`${segment.type} 段必须提供已上传的 media_id 或 wechat://media/{id}`);
            }
            messages.push(mediaMessage(mediaType, mediaId, segment.data));
            continue;
        }
        if (segment.type === "news") {
            const articles = segment.data.articles;
            if (!Array.isArray(articles) || articles.length === 0) {
                invalid("news 段必须提供非空 articles");
            }
            messages.push({ msgtype: "news", news: { articles: structuredClone(articles) } });
            continue;
        }
        invalid(`不支持消息段 ${segment.type}`);
    }
    flushText();
    if (messages.length === 0) invalid("消息内容不能为空");
    return { messages, replyEventId };
}

function nativeMessage(data: Record<string, unknown>): WechatOutboundMessage {
    const value = data.message || data;
    if (!isRecord(value) || typeof value.msgtype !== "string" || !value.msgtype) {
        return invalid("wechat_message 段必须提供含 msgtype 的 message 对象");
    }
    return structuredClone(value) as WechatOutboundMessage;
}

function mediaMessage(
    type: "image" | "voice" | "video",
    mediaId: string,
    data: Record<string, unknown>,
): WechatOutboundMessage {
    if (type !== "video") return { msgtype: type, [type]: { media_id: mediaId } };
    return {
        msgtype: "video",
        video: {
            media_id: mediaId,
            thumb_media_id: stringValue(data.thumb_media_id),
            title: stringValue(data.title),
            description: stringValue(data.description),
        },
    };
}

function mediaMessageType(type: string): "image" | "voice" | "video" | undefined {
    if (type === "image") return "image";
    if (type === "voice" || type === "audio" || type === "record") return "voice";
    if (type === "video") return "video";
    return undefined;
}

function mediaIdFromFile(value: unknown): string | undefined {
    const file = stringValue(value);
    if (!file) return undefined;
    if (file.startsWith("wechat://media/"))
        return file.slice("wechat://media/".length) || undefined;
    return /^[\w-]+$/u.test(file) ? file : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WechatApiError(`微信公众号 ${message}`, { code: "WECHAT_INVALID_MESSAGE" });
}
