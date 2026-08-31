import type { CommonTypes } from "onebots";
import { FacebookMessengerError } from "./errors.js";
import type {
    MessengerApiMessage,
    MessengerAttachment,
    MessengerOutgoingMessage,
} from "./types.js";
import { isRecord, requireArray, requireRecord, requireString } from "./validation.js";

export interface MessengerAttachmentUploader {
    upload(
        type: "image" | "video" | "audio" | "file",
        source: { url: string } | { blob: Blob; filename: string },
        reusable: boolean,
    ): Promise<string>;
}

/** 编译为一个 Send API message；拒绝会隐式拆成多个 message_id 的组合。 */
export async function compileMessengerMessage(
    segments: readonly CommonTypes.Segment[],
    uploader: MessengerAttachmentUploader,
): Promise<MessengerOutgoingMessage> {
    const native = segments.filter(segment => segment.type === "facebook_messenger");
    if (native.length) {
        if (native.length !== 1 || segments.length !== 1) {
            return invalid("facebook_messenger 原生段必须独占一条消息");
        }
        return structuredClone(
            requireRecord(native[0].data.message ?? native[0].data, "facebook_messenger.message"),
        ) as MessengerOutgoingMessage;
    }

    const reply = segments.filter(segment => segment.type === "reply");
    if (reply.length > 1) return invalid("一条消息只能包含一个 reply 段");
    const quickReplies = segments.filter(segment => segment.type === "messenger_quick_replies");
    if (quickReplies.length > 1) return invalid("一条消息只能包含一个 quick replies 段");
    const text = segments
        .filter(segment => segment.type === "text")
        .map(segment => String(segment.data.text ?? ""))
        .join("");
    const media = segments.filter(segment =>
        ["image", "video", "audio", "record", "file"].includes(segment.type),
    );
    const unsupported = segments.filter(
        segment =>
            ![
                "text",
                "reply",
                "image",
                "video",
                "audio",
                "record",
                "file",
                "messenger_quick_replies",
            ].includes(segment.type),
    );
    if (unsupported.length) return invalid(`不支持消息段 ${unsupported[0].type}`);
    if (text && media.length) {
        return invalid("Messenger 单次 Send API 不能同时发送文本和媒体，请拆成两条消息");
    }
    if (media.length > 1 && media.some(segment => segment.type !== "image")) {
        return invalid("Messenger 多附件消息只支持最多 30 张图片");
    }
    if (media.length > 30) return invalid("Messenger 单条消息最多包含 30 张图片");
    if (quickReplies.length && !text) return invalid("quick replies 必须附着在文本消息上");

    const message: MessengerOutgoingMessage = {};
    if (text) message.text = text;
    if (media.length === 1) {
        message.attachment = await compileAttachment(media[0], uploader);
    } else if (media.length > 1) {
        message.attachments = await Promise.all(
            media.map(segment => compileAttachment(segment, uploader)),
        );
    }
    if (quickReplies.length) {
        const items = requireArray(
            quickReplies[0].data.items ?? quickReplies[0].data.quick_replies,
            "messenger_quick_replies.items",
        );
        if (!items.length || items.length > 13) {
            return invalid("Messenger quick replies 必须包含 1 到 13 项");
        }
        message.quick_replies = items.map((item, index) =>
            validateQuickReply(item, `messenger_quick_replies.items[${index}]`),
        );
    }
    if (reply.length) {
        message.reply_to = {
            mid: firstString(reply[0].data, ["message_id", "id"], "reply"),
        };
    }
    if (!message.text && !message.attachment && !message.attachments) {
        return invalid("消息没有可发送内容");
    }
    return message;
}

export function projectWebhookMessage(message: {
    text?: string;
    attachments?: MessengerAttachment[];
    quick_reply?: { payload: string };
    reply_to?: { mid: string };
    referral?: Record<string, unknown>;
}): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (message.reply_to) segments.push({ type: "reply", data: { id: message.reply_to.mid } });
    if (message.text) segments.push({ type: "text", data: { text: message.text } });
    for (const attachment of message.attachments || []) {
        segments.push(projectWebhookAttachment(attachment));
    }
    if (message.quick_reply) {
        segments.push({
            type: "messenger_quick_reply",
            data: { payload: message.quick_reply.payload },
        });
    }
    if (message.referral) {
        segments.push({ type: "messenger_referral", data: structuredClone(message.referral) });
    }
    return segments;
}

export function projectApiMessage(message: MessengerApiMessage): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (message.reply_to) segments.push({ type: "reply", data: { id: message.reply_to.mid } });
    if (message.message) segments.push({ type: "text", data: { text: message.message } });
    for (const attachment of message.attachments?.data || []) {
        const type =
            typeof attachment.mime_type === "string" ? mediaType(attachment.mime_type) : "file";
        const url = findUrl(attachment);
        segments.push({
            type,
            data: {
                ...(url ? { url } : {}),
                ...(typeof attachment.name === "string" ? { name: attachment.name } : {}),
                messenger_attachment: structuredClone(attachment),
            },
        });
    }
    return segments;
}

async function compileAttachment(
    segment: CommonTypes.Segment,
    uploader: MessengerAttachmentUploader,
): Promise<Record<string, unknown>> {
    const type = normalizeMediaType(segment.type);
    const data = requireRecord(segment.data, `${segment.type}.data`);
    const attachmentId = optionalString(data.attachment_id ?? data.id);
    if (attachmentId) return { type, payload: { attachment_id: attachmentId } };
    const reusable = data.is_reusable === true;
    if (data.path !== undefined) {
        return invalid("消息媒体不读取宿主本地路径；请传 base64 data、HTTPS URL 或 attachment_id");
    }
    const remote = optionalString(data.url ?? data.file);
    if (remote) {
        if (!URL.canParse(remote)) return invalid("媒体 url/file 不是有效 URL");
        const url = new URL(remote);
        if (url.protocol !== "https:" || url.username || url.password) {
            return invalid("媒体 URL 必须是无凭据 HTTPS URL");
        }
        return { type, payload: { url: url.toString(), is_reusable: reusable } };
    }
    const encoded = optionalString(data.data);
    if (!encoded) return invalid(`${segment.type} 缺少 url/file、data 或 attachment_id`);
    const materialized = decodeMediaData(
        encoded,
        optionalString(data.name ?? data.filename) || "attachment.bin",
        optionalString(data.mime_type ?? data.content_type),
    );
    const attachment = await uploader.upload(
        type,
        {
            blob: new Blob([new Uint8Array(materialized.data)], { type: materialized.contentType }),
            filename: materialized.filename,
        },
        reusable,
    );
    return { type, payload: { attachment_id: attachment } };
}

function decodeMediaData(
    source: string,
    filename: string,
    declaredType?: string,
): { data: Uint8Array; filename: string; contentType: string } {
    const match = source.match(/^data:([^;,]+);base64,(.*)$/su);
    const encoded = match ? match[2] : source;
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
        return invalid("媒体 data 不是有效 base64");
    }
    const data = new Uint8Array(Buffer.from(encoded, "base64"));
    if (!data.byteLength || data.byteLength > 25 * 1024 * 1024) {
        return invalid("媒体 data 必须介于 1 byte 与 25 MiB");
    }
    const contentType = match?.[1] || declaredType || "application/octet-stream";
    if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/u.test(contentType)) {
        return invalid("媒体 content type 无效");
    }
    return { data, filename: safeFilename(filename), contentType };
}

function safeFilename(value: string): string {
    const filename = value.replace(/\\/gu, "/").split("/").at(-1) || "attachment.bin";
    return filename.replace(/[\u0000-\u001f\u007f"\\]/gu, "_").slice(0, 255);
}

function projectWebhookAttachment(attachment: MessengerAttachment): CommonTypes.Segment {
    if (attachment.type === "location") {
        const coordinates = isRecord(attachment.payload.coordinates)
            ? attachment.payload.coordinates
            : {};
        return {
            type: "location",
            data: {
                latitude: coordinates.lat,
                longitude: coordinates.long,
                title: attachment.payload.title,
                url: attachment.payload.url,
                messenger_attachment: structuredClone(attachment),
            },
        };
    }
    const type = ["image", "video", "audio", "file"].includes(attachment.type)
        ? attachment.type
        : "messenger_attachment";
    return {
        type,
        data: {
            ...(typeof attachment.payload.url === "string" ? { url: attachment.payload.url } : {}),
            ...(typeof attachment.payload.title === "string"
                ? { name: attachment.payload.title }
                : {}),
            messenger_attachment: structuredClone(attachment),
        },
    };
}

function validateQuickReply(value: unknown, field: string): Record<string, unknown> {
    const item = structuredClone(requireRecord(value, field));
    const contentType = requireString(item.content_type, `${field}.content_type`);
    if (!["text", "user_phone_number", "user_email"].includes(contentType)) {
        return invalid(`${field}.content_type 无效`);
    }
    if (contentType === "text") {
        requireString(item.title, `${field}.title`);
        requireString(item.payload, `${field}.payload`);
    }
    if (item.image_url !== undefined) assertHttpsUrl(item.image_url, `${field}.image_url`);
    return item;
}

function findUrl(value: Record<string, unknown>): string | undefined {
    for (const candidate of [value.image_data, value.video_data, value.file_url, value.url]) {
        if (typeof candidate === "string" && URL.canParse(candidate)) return candidate;
        if (isRecord(candidate) && typeof candidate.url === "string") return candidate.url;
    }
    return undefined;
}

function mediaType(mime: string): string {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
}

function normalizeMediaType(type: string): "image" | "video" | "audio" | "file" {
    if (type === "record") return "audio";
    return type as "image" | "video" | "audio" | "file";
}

function firstString(data: Record<string, unknown>, fields: string[], context: string): string {
    for (const field of fields) {
        const value = optionalString(data[field]);
        if (value) return value;
    }
    return invalid(`${context} 缺少 ${fields.join("/")}`);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function assertHttpsUrl(value: unknown, field: string): void {
    const raw = requireString(value, field);
    if (!URL.canParse(raw)) return invalid(`${field} 不是有效 URL`);
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) {
        return invalid(`${field} 必须是无凭据 HTTPS URL`);
    }
}

function invalid(message: string): never {
    throw FacebookMessengerError.invalid(`Facebook Messenger ${message}`);
}
