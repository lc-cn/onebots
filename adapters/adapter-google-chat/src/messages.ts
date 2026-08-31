import type { CommonTypes } from "onebots";
import { GoogleChatError } from "./errors.js";
import type { GoogleChatAttachment, GoogleChatMessage } from "./types.js";
import { isRecord } from "./validation.js";

export interface CompiledGoogleChatMessage {
    text?: string;
    attachment?: Array<{ attachmentDataRef: Record<string, unknown>; contentName?: string }>;
}

export function compileGoogleChatMessage(
    segments: readonly CommonTypes.Segment[],
): CompiledGoogleChatMessage {
    if (!segments.length) throw GoogleChatError.invalid("Google Chat 消息不能为空");
    let text = "";
    const attachment: Array<{ attachmentDataRef: Record<string, unknown>; contentName?: string }> =
        [];
    for (const segment of segments) {
        if (!isRecord(segment.data)) throw GoogleChatError.invalid("消息段 data 必须是对象");
        if (segment.type === "text") {
            text += requireText(segment.data.text, "text.text");
            continue;
        }
        if (segment.type === "at") {
            const user = requireText(segment.data.user_id ?? segment.data.id, "at.user_id");
            if (!/^users\/(?:all|app|[^/]+)$/u.test(user))
                throw GoogleChatError.invalid("at.user_id 必须是 Google Chat user resource name");
            text += `<${user}>`;
            continue;
        }
        if (segment.type === "emoji") {
            text += requireText(segment.data.emoji ?? segment.data.name, "emoji.emoji");
            continue;
        }
        if (["image", "video", "audio", "file"].includes(segment.type)) {
            const ref = segment.data.attachment_data_ref;
            if (!isRecord(ref))
                throw new GoogleChatError(
                    "Google Chat 附件必须先通过 upload_file 获取 attachment_data_ref",
                    { code: "GOOGLE_CHAT_UPLOAD_REQUIRED" },
                );
            attachment.push({
                attachmentDataRef: ref,
                contentName: optionalString(segment.data.name),
            });
            continue;
        }
        throw new GoogleChatError(`Google Chat 不支持消息段 ${segment.type}`, {
            code: "GOOGLE_CHAT_UNSUPPORTED_SEGMENT",
        });
    }
    return { text: text || undefined, attachment: attachment.length ? attachment : undefined };
}

export function projectGoogleChatMessage(message: GoogleChatMessage): CommonTypes.Segment[] {
    const result: CommonTypes.Segment[] = [];
    if (message.text)
        result.push({
            type: "text",
            data: {
                text: message.text,
                formatted_text: message.formattedText,
                annotations: message.annotations,
            },
        });
    for (const item of message.attachment || []) result.push(projectAttachment(item));
    if (!result.length && message.cardsV2?.length) {
        result.push({
            type: "google_chat_card",
            data: { cards: message.cardsV2, accessory_widgets: message.accessoryWidgets },
        });
    }
    return result;
}

function projectAttachment(attachment: GoogleChatAttachment): CommonTypes.Segment {
    const type = attachment.contentType.startsWith("image/")
        ? "image"
        : attachment.contentType.startsWith("video/")
          ? "video"
          : attachment.contentType.startsWith("audio/")
            ? "audio"
            : "file";
    return {
        type,
        data: {
            name: attachment.contentName,
            content_type: attachment.contentType,
            url: attachment.downloadUri,
            resource_name: attachment.name,
            attachment_data_ref: attachment.attachmentDataRef,
            drive_data_ref: attachment.driveDataRef,
        },
    };
}

function requireText(value: unknown, field: string): string {
    if (typeof value !== "string" || !value)
        throw GoogleChatError.invalid(`${field} 必须是非空字符串`);
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
