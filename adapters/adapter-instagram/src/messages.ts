import type { CommonTypes } from "onebots";
import { InstagramError } from "./errors.js";
import type {
    InstagramApiMessage,
    InstagramAttachment,
    InstagramMessage,
    InstagramOutgoingMessage,
} from "./types.js";
import { assertHttpsUrl, requireArray, requireRecord, requireString } from "./validation.js";

export interface InstagramAttachmentUploader {
    upload(
        type: "image" | "video" | "audio",
        source: { blob: Blob; filename: string },
        reusable: boolean,
    ): Promise<string>;
}

/** 编译为一个 Instagram Send API message；不隐式拆分成多个 message_id。 */
export async function compileInstagramMessage(
    segments: readonly CommonTypes.Segment[],
    uploader: InstagramAttachmentUploader,
): Promise<InstagramOutgoingMessage> {
    const native = segments.filter(segment => segment.type === "instagram");
    if (native.length) {
        if (native.length !== 1 || segments.length !== 1) {
            return invalid("instagram 原生段必须独占一条消息");
        }
        return structuredClone(
            requireRecord(native[0].data.message ?? native[0].data, "instagram.message"),
        ) as InstagramOutgoingMessage;
    }

    const replies = segments.filter(segment => segment.type === "reply");
    const quickReplies = segments.filter(segment => segment.type === "instagram_quick_replies");
    const media = segments.filter(segment =>
        ["image", "video", "audio", "record"].includes(segment.type),
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
                "instagram_quick_replies",
            ].includes(segment.type),
    );
    if (unsupported.length) return invalid(`不支持消息段 ${unsupported[0].type}`);
    if (replies.length > 1) return invalid("一条消息只能包含一个 reply 段");
    if (quickReplies.length > 1) return invalid("一条消息只能包含一组 quick replies");
    if (media.length > 1) return invalid("Instagram 单次 Send API 只支持一个媒体附件");

    const text = segments
        .filter(segment => segment.type === "text")
        .map(segment => String(segment.data.text ?? ""))
        .join("");
    if (text && media.length) {
        return invalid("Instagram 单次 Send API 不能同时发送文本和媒体，请拆成两条消息");
    }
    if (quickReplies.length && !text) return invalid("quick replies 必须附着在文本消息上");

    const message: InstagramOutgoingMessage = {};
    if (text) message.text = text;
    if (media.length) message.attachment = await compileAttachment(media[0], uploader);
    if (replies.length) {
        message.reply_to = {
            mid: firstString(replies[0].data, ["message_id", "id"], "reply"),
        };
    }
    if (quickReplies.length) {
        const items = requireArray(
            quickReplies[0].data.items ?? quickReplies[0].data.quick_replies,
            "instagram_quick_replies.items",
        );
        if (!items.length || items.length > 13) {
            return invalid("Instagram quick replies 必须包含 1 到 13 项");
        }
        message.quick_replies = items.map((item, index) =>
            validateQuickReply(item, `instagram_quick_replies.items[${index}]`),
        );
    }
    if (!message.text && !message.attachment) return invalid("消息没有可发送内容");
    return message;
}

export function projectWebhookMessage(message: InstagramMessage): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    const replyMid = message.reply_to?.mid;
    if (typeof replyMid === "string" && replyMid) {
        segments.push({ type: "reply", data: { id: replyMid } });
    }
    if (message.text) segments.push({ type: "text", data: { text: message.text } });
    for (const attachment of message.attachments || []) {
        segments.push(projectWebhookAttachment(attachment));
    }
    if (message.quick_reply) {
        segments.push({
            type: "instagram_quick_reply",
            data: { payload: message.quick_reply.payload },
        });
    }
    if (message.referral) {
        segments.push({ type: "instagram_referral", data: structuredClone(message.referral) });
    }
    if (message.reply_to && typeof replyMid !== "string") {
        segments.push({ type: "instagram_reply_context", data: structuredClone(message.reply_to) });
    }
    return segments;
}

export function projectApiMessage(message: InstagramApiMessage): CommonTypes.Segment[] {
    return message.message ? [{ type: "text", data: { text: message.message } }] : [];
}

async function compileAttachment(
    segment: CommonTypes.Segment,
    uploader: InstagramAttachmentUploader,
): Promise<Record<string, unknown>> {
    const type = normalizeMediaType(segment.type);
    const data = requireRecord(segment.data, `${segment.type}.data`);
    const attachmentId = optionalString(data.attachment_id ?? data.id);
    if (attachmentId) return { type, payload: { attachment_id: attachmentId } };
    if (data.path !== undefined) {
        return invalid("消息媒体不读取宿主本地路径；请传 base64 data、HTTPS URL 或 attachment_id");
    }
    const remote = optionalString(data.url ?? data.file);
    if (remote) {
        return { type, payload: { url: assertHttpsUrl(remote, `${segment.type}.url`) } };
    }
    const encoded = optionalString(data.data);
    if (!encoded) return invalid(`${segment.type} 缺少 url/file、data 或 attachment_id`);
    const materialized = decodeMediaData(
        encoded,
        optionalString(data.name ?? data.filename) || "attachment.bin",
        optionalString(data.mime_type ?? data.content_type),
    );
    const attachmentIdFromUpload = await uploader.upload(
        type,
        {
            blob: new Blob([new Uint8Array(materialized.data)], {
                type: materialized.contentType,
            }),
            filename: materialized.filename,
        },
        true,
    );
    return { type, payload: { attachment_id: attachmentIdFromUpload } };
}

function validateQuickReply(value: unknown, field: string): Record<string, unknown> {
    const item = structuredClone(requireRecord(value, field));
    const contentType = requireString(item.content_type, `${field}.content_type`);
    if (!["text", "user_phone_number", "user_email"].includes(contentType)) {
        return invalid(`${field}.content_type 无效`);
    }
    if (contentType === "text") {
        const title = requireString(item.title, `${field}.title`);
        if ([...title].length > 20) return invalid(`${field}.title 不能超过 20 个字符`);
    }
    requireString(item.payload, `${field}.payload`);
    return item;
}

function projectWebhookAttachment(attachment: InstagramAttachment): CommonTypes.Segment {
    const type = ["image", "video", "audio"].includes(attachment.type)
        ? attachment.type
        : "instagram_attachment";
    return {
        type,
        data: {
            ...(typeof attachment.payload.url === "string" ? { url: attachment.payload.url } : {}),
            instagram_attachment: structuredClone(attachment),
        },
    };
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

function normalizeMediaType(type: string): "image" | "video" | "audio" {
    return type === "record" ? "audio" : (type as "image" | "video" | "audio");
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

function invalid(message: string): never {
    throw InstagramError.invalid(`Instagram ${message}`);
}
