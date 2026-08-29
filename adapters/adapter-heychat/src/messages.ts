import type { CommonTypes } from "onebots";
import { HeychatApiError } from "./errors.js";
import type { HeychatImageInfo, HeychatOutboundMessage } from "./types.js";

interface MessageParts {
    text: string[];
    images: HeychatImageInfo[];
    users: string[];
    roles: string[];
    channels: string[];
    replyId?: string;
    native?: HeychatOutboundMessage;
}

/** 将通用消息段编译为黑盒语音官方 Markdown/图片/卡片请求。 */
export function compileHeychatMessage(
    segments: CommonTypes.Segment[],
    resolveId: (value: unknown) => string = value => String(value ?? ""),
): HeychatOutboundMessage {
    const parts: MessageParts = { text: [], images: [], users: [], roles: [], channels: [] };
    for (const segment of segments) appendSegment(parts, segment, resolveId);

    if (parts.native) {
        if (
            parts.text.length ||
            parts.images.length ||
            parts.users.length ||
            parts.roles.length ||
            parts.channels.length
        ) {
            throw invalidMessage("heychat_message 原生消息段必须单独发送");
        }
        return { ...parts.native, reply_id: parts.native.reply_id || parts.replyId || "" };
    }

    const prefix = [
        ...parts.users.map(id => `@{id:${id}}`),
        ...parts.roles.map(id => `@{id:${id}}`),
        ...parts.channels.map(id => `#{id:${id}}`),
    ].join("");
    const body = [...parts.text, ...parts.images.map(image => `![](${image.url})`)]
        .filter(Boolean)
        .join("\n\n");
    const msg = `${prefix}${prefix && body ? " " : ""}${body}`;
    if (!msg) throw invalidMessage("消息段为空或不包含黑盒语音可发送内容");

    if (parts.images.length === 1 && !parts.text.length && !prefix) {
        return {
            msg_type: 3,
            img: parts.images[0].url,
            addition: stringifyAddition(parts.images),
            reply_id: parts.replyId || "",
        };
    }

    return {
        msg,
        msg_type: parts.users.length || parts.roles.length || parts.channels.length ? 10 : 4,
        addition: stringifyAddition(parts.images),
        reply_id: parts.replyId || "",
        at_user_id: parts.users.join(","),
        at_role_id: parts.roles.join(","),
        mention_channel_id: parts.channels.join(","),
    };
}

function appendSegment(
    parts: MessageParts,
    segment: CommonTypes.Segment,
    resolveId: (value: unknown) => string,
): void {
    if (typeof segment === "string") {
        parts.text.push(segment);
        return;
    }
    const data = isRecord(segment.data) ? segment.data : {};
    switch (segment.type) {
        case "text":
        case "markdown":
            appendString(parts.text, data.text ?? data.content);
            return;
        case "at": {
            const id = resolveId(data.id ?? data.user_id ?? data.qq);
            if (id) parts.users.push(id);
            return;
        }
        case "reply":
            parts.replyId = resolveId(data.id ?? data.message_id);
            return;
        case "image": {
            const url = stringValue(data.url ?? data.file);
            if (!url || !URL.canParse(url)) {
                throw invalidMessage(
                    "图片消息需要可访问的 URL；本地或 Base64 文件请先调用 upload_media",
                );
            }
            parts.images.push({
                url,
                width: positiveNumber(data.width),
                height: positiveNumber(data.height),
            });
            return;
        }
        case "heychat_role": {
            const id = resolveId(data.id ?? data.role_id);
            if (id) parts.roles.push(id);
            return;
        }
        case "heychat_channel": {
            const id = resolveId(data.id ?? data.channel_id);
            if (id) parts.channels.push(id);
            return;
        }
        case "heychat_message":
            parts.native = parseNativeMessage(data.body ?? data);
            return;
        default:
            appendString(parts.text, data.text);
    }
}

function parseNativeMessage(value: unknown): HeychatOutboundMessage {
    if (!isRecord(value)) throw invalidMessage("heychat_message.data.body 必须为对象");
    const msgType = value.msg_type;
    if (msgType !== 3 && msgType !== 4 && msgType !== 10 && msgType !== 20) {
        throw invalidMessage("heychat_message.msg_type 必须是 3、4、10 或 20");
    }
    const addition = typeof value.addition === "string" ? value.addition : "{}";
    return { ...value, msg_type: msgType, addition };
}

function stringifyAddition(images: HeychatImageInfo[]): string {
    return JSON.stringify({
        img_files_info: images.map(image => ({
            url: image.url,
            ...(image.width ? { width: image.width } : {}),
            ...(image.height ? { height: image.height } : {}),
        })),
    });
}

function appendString(target: string[], value: unknown): void {
    const text = stringValue(value);
    if (text) target.push(text);
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function positiveNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidMessage(message: string): HeychatApiError {
    return new HeychatApiError(message, { code: "HEYCHAT_INVALID_MESSAGE" });
}
