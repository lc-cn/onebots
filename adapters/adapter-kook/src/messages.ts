import { materializeMediaSource, type CommonTypes } from "onebots";
import { KookError } from "./errors.js";
import type { KookMessageType, KookSendMessage } from "./types.js";
import { escapeKMarkdown, parseKMarkdown, stringValue } from "./utils.js";

const MEDIA_TYPES: Record<string, KookMessageType> = {
    image: 2,
    video: 3,
    file: 4,
    audio: 8,
};

/** 上传通用媒体来源后构建 KOOK 消息，确保素材属于当前机器人。 */
export async function prepareKookOutboundMessage(
    segments: CommonTypes.Segment[],
    upload: (data: Uint8Array, filename: string, contentType: string) => Promise<string>,
): Promise<KookSendMessage> {
    const resolved = await Promise.all(
        segments.map(async segment => {
            if (!MEDIA_TYPES[segment.type]) return segment;
            const source = stringValue(segment.data.url || segment.data.file || segment.data.src);
            if (!source) {
                throw KookError.invalid(
                    `KOOK ${segment.type} 消息必须提供 url 或 file`,
                    "KOOK_MEDIA_SOURCE_REQUIRED",
                    { segment_type: segment.type },
                );
            }
            const media = await materializeMediaSource({
                source,
                filename: optionalString(segment.data.filename || segment.data.name),
                contentType: optionalString(segment.data.content_type || segment.data.mime),
            });
            const url = await upload(media.data, media.filename, media.contentType);
            return { ...segment, data: { ...segment.data, url } };
        }),
    );
    return buildKookOutboundMessage(resolved);
}

/** KOOK 官方只允许编辑 KMarkdown 与 Card 消息。 */
export function assertKookEditableMessage(segments: CommonTypes.Segment[]): void {
    const type = buildKookOutboundMessage(segments).type;
    if (type !== 9 && type !== 10) {
        throw KookError.invalid(
            "KOOK 只支持更新 KMarkdown 或 Card 消息",
            "KOOK_MESSAGE_NOT_EDITABLE",
            { message_type: type },
        );
    }
}

/** 将统一消息段编译为 KOOK 原生消息；混合富媒体使用 Card，避免降级成 URL 文本。 */
export function buildKookOutboundMessage(segments: CommonTypes.Segment[]): KookSendMessage {
    let quote: string | undefined;
    const contentSegments = segments.filter(segment => {
        if (segment.type !== "reply") return true;
        quote = stringValue(segment.data.message_id || segment.data.id);
        return false;
    });
    if (contentSegments.length === 1) {
        const segment = contentSegments[0];
        const mediaType = MEDIA_TYPES[segment.type];
        const url = stringValue(segment.data.url || segment.data.file);
        if (mediaType && url) return { type: mediaType as 2 | 3 | 4 | 8, content: url, quote };
        if (segment.type === "card") {
            return { type: 10, content: cardContent(segment.data), quote };
        }
        if (segment.type === "kmarkdown" || segment.type === "markdown") {
            return {
                type: 9,
                content: stringValue(segment.data.content || segment.data.text),
                quote,
            };
        }
    }
    if (contentSegments.some(segment => MEDIA_TYPES[segment.type] || segment.type === "card")) {
        return { type: 10, content: JSON.stringify(buildCard(contentSegments)), quote };
    }
    return { type: 9, content: buildKMarkdown(contentSegments), quote };
}

export function projectKookMessageSegments(
    type: KookMessageType,
    content: unknown,
    mentions: string[] = [],
): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = mentions.map(userId => ({
        type: "at",
        data: { user_id: userId },
    }));
    const text = stringValue(content);
    if (type === 1 || type === 9) {
        if (text) segments.push({ type: "text", data: { text: parseKMarkdown(text) } });
    } else if (type === 2) segments.push({ type: "image", data: { url: text } });
    else if (type === 3) segments.push({ type: "video", data: { url: text } });
    else if (type === 4) segments.push({ type: "file", data: { url: text } });
    else if (type === 8) segments.push({ type: "audio", data: { url: text } });
    else if (type === 10) {
        segments.push({ type: "card", data: { content: text, cards: parseJson(text) } });
    } else segments.push({ type: "kook", data: { type, content } });
    return segments;
}

/** KOOK 更新事件不携带消息类型，仅在内容满足官方 Card 数组结构时按 Card 投影。 */
export function projectKookEditableContent(content: unknown): CommonTypes.Segment[] {
    const text = stringValue(content);
    return projectKookMessageSegments(isKookCardContent(text) ? 10 : 9, text);
}

function isKookCardContent(content: string): boolean {
    const value = parseJson(content);
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
            card =>
                card !== null &&
                typeof card === "object" &&
                !Array.isArray(card) &&
                (card as Record<string, unknown>).type === "card",
        )
    );
}

function buildKMarkdown(segments: CommonTypes.Segment[]): string {
    let result = "";
    for (const segment of segments) {
        if (segment.type === "text") result += escapeKMarkdown(stringValue(segment.data.text));
        else if (segment.type === "at") {
            const id = stringValue(segment.data.user_id || segment.data.id || segment.data.qq);
            if (id) result += `(met)${id}(/met)`;
        } else if (segment.type === "role") {
            const id = stringValue(segment.data.role_id || segment.data.id);
            if (id) result += `(rol)${id}(/rol)`;
        } else if (segment.type === "channel") {
            const id = stringValue(segment.data.channel_id || segment.data.id);
            if (id) result += `(chn)${id}(/chn)`;
        } else if (segment.type === "kmarkdown" || segment.type === "markdown") {
            result += stringValue(segment.data.content || segment.data.text);
        } else if (segment.type === "face") {
            const name = stringValue(segment.data.name, stringValue(segment.data.id));
            const id = stringValue(segment.data.id);
            result += id ? `(emj)${name}(/emj)[${id}]` : `:${name}:`;
        }
    }
    return result;
}

function buildCard(segments: CommonTypes.Segment[]): Array<Record<string, unknown>> {
    const modules: Array<Record<string, unknown>> = [];
    const markdown = buildKMarkdown(segments.filter(segment => !MEDIA_TYPES[segment.type]));
    if (markdown) modules.push({ type: "section", text: { type: "kmarkdown", content: markdown } });
    const images = segments
        .filter(segment => segment.type === "image")
        .map(segment => ({ type: "image", src: stringValue(segment.data.url), alt: "图片" }))
        .filter(image => image.src);
    if (images.length) modules.push({ type: "container", elements: images });
    for (const segment of segments) {
        if (!["file", "audio", "video"].includes(segment.type)) continue;
        const src = stringValue(segment.data.url || segment.data.file);
        if (!src) continue;
        modules.push({
            type: segment.type,
            src,
            title: stringValue(segment.data.name || segment.data.filename, segment.type),
        });
    }
    return [{ type: "card", theme: "none", size: "lg", modules }];
}

function cardContent(data: Record<string, unknown>): string {
    const content = data.content;
    if (typeof content === "string") return content;
    const card = data.cards || data.card || content;
    if (!card) {
        throw KookError.invalid(
            "KOOK card 消息必须提供 content、card 或 cards",
            "KOOK_CARD_CONTENT_REQUIRED",
        );
    }
    return JSON.stringify(Array.isArray(card) ? card : [card]);
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return undefined;
    }
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}
