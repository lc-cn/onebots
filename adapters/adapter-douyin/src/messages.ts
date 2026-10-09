import type { MessageEvent, SendableMessage, SendableText } from "douyin-im";
import { AdapterError, type CommonTypes } from "onebots";

export function projectDouyinSegments(
    event: Pick<MessageEvent, "content" | "mentions" | "referenceInfo" | "text">,
    createId: (value: string | number) => CommonTypes.Id,
): CommonTypes.Segment[] {
    const result: CommonTypes.Segment[] = [];
    if (event.referenceInfo?.refMessageId) {
        result.push({
            type: "reply",
            data: { message_id: createId(event.referenceInfo.refMessageId) },
        });
    }

    if (event.content.kind === "text") {
        result.push(...projectText(event.text, event.mentions, createId));
        return result;
    }

    const content = event.content;
    if (content.kind === "image") {
        result.push({
            type: "image",
            data: {
                file: firstUrl(
                    content.image.originUrls,
                    content.image.largeUrls,
                    content.image.mediumUrls,
                    content.image.thumbUrls,
                ),
                width: content.image.width,
                height: content.image.height,
                douyin: content.image,
            },
        });
    } else if (content.kind === "video") {
        result.push({ type: "video", data: { douyin: content.video } });
    } else if (content.kind === "audio") {
        result.push({
            type: "audio",
            data: { file: content.audio.urls[0] ?? content.audio.uri, douyin: content.audio },
        });
    } else if (content.kind === "file") {
        result.push({ type: "file", data: { ...content.file } });
    } else if (content.kind === "link") {
        result.push({ type: "link", data: { ...content.link } });
    } else if (content.kind === "emoji") {
        result.push({ type: "image", data: { file: content.url, emoji: true } });
    } else {
        result.push({ type: "text", data: { text: content.text || event.text } });
    }
    return result;
}

export function compileDouyinMessage(
    input: readonly CommonTypes.Segment[],
    resolveId: (value: unknown) => string,
): SendableMessage[] {
    if (!input.length) throw fault("MESSAGE_EMPTY", "抖音消息段不能为空");
    const operations: SendableMessage[] = [];
    let text: SendableText[] = [];
    const flush = () => {
        if (text.length) operations.push(text.length === 1 ? text[0]! : text);
        text = [];
    };

    for (const item of input) {
        if (item.type === "text") {
            text.push({ type: "text", text: requiredString(item.data.text, "text") });
        } else if (item.type === "at") {
            const source = item.data.user_id ?? item.data.qq ?? item.data.uid;
            const uid = resolveId(source);
            const name = optionalString(item.data.name) ?? optionalString(item.data.text) ?? uid;
            if (!/^\d+$/u.test(uid)) throw fault("PARAM_INVALID", "抖音 @ 用户 ID 必须为数字");
            text.push({ type: "at", uid, name: name.replace(/^@/u, "") });
        } else if (item.type === "image") {
            flush();
            const source = item.data.file ?? item.data.url ?? item.data.base64;
            operations.push({ type: "image", data: requiredString(source, "图片来源") });
        } else {
            throw fault("MESSAGE_SEGMENT_UNSUPPORTED", `抖音发送暂不支持消息段 ${item.type}`);
        }
    }
    flush();
    return operations;
}

function projectText(
    text: string,
    mentions: MessageEvent["mentions"],
    createId: (value: string | number) => CommonTypes.Id,
): CommonTypes.Segment[] {
    if (!mentions.length) return [{ type: "text", data: { text } }];
    const result: CommonTypes.Segment[] = [];
    let cursor = 0;
    for (const mention of [...mentions].sort((left, right) => left.location - right.location)) {
        if (mention.location > cursor) {
            result.push({ type: "text", data: { text: text.slice(cursor, mention.location) } });
        }
        result.push({
            type: "at",
            data: { user_id: createId(mention.uid), name: mention.text.replace(/^@/u, "") },
        });
        cursor = mention.location + mention.length;
    }
    if (cursor < text.length) result.push({ type: "text", data: { text: text.slice(cursor) } });
    return result;
}

function firstUrl(...groups: readonly string[][]): string | undefined {
    return groups.flat().find(Boolean);
}

function requiredString(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw fault("PARAM_INVALID", `抖音${label}必须是非空字符串`);
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

function fault(code: string, message: string): AdapterError {
    return new AdapterError(message, { code, context: { platform: "douyin" } });
}
