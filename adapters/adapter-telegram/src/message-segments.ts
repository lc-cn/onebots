import type { Message, MessageEntity } from "grammy/types";
import type { CommonTypes } from "onebots";
import type { TelegramEventProjectorContext } from "./event-context.js";

/** 将 Telegram 消息内容投影为有序通用消息段。 */
export function projectTelegramSegments(
    message: Message,
    context: TelegramEventProjectorContext,
): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (message.text) appendTextSegments(segments, message.text, message.entities ?? [], context);
    if (message.caption) {
        appendTextSegments(segments, message.caption, message.caption_entities ?? [], context);
    }
    if (message.rich_message) {
        segments.push({
            type: "telegram_rich_message",
            data: { rich_message: structuredClone(message.rich_message) },
        });
    }
    if (message.photo?.length) {
        segments.push({
            type: "image",
            data: { file: message.photo[message.photo.length - 1]?.file_id },
        });
    }
    if (message.video) segments.push({ type: "video", data: { file: message.video.file_id } });
    if (message.video_note) {
        segments.push({
            type: "video",
            data: { file: message.video_note.file_id, video_note: true },
        });
    }
    if (message.animation) {
        segments.push({
            type: "video",
            data: { file: message.animation.file_id, animation: true },
        });
    }
    if (message.audio) segments.push({ type: "audio", data: { file: message.audio.file_id } });
    if (message.voice) {
        segments.push({ type: "audio", data: { file: message.voice.file_id, voice: true } });
    }
    if (message.document) {
        segments.push({
            type: "file",
            data: { file: message.document.file_id, name: message.document.file_name },
        });
    }
    if (message.sticker) {
        segments.push({
            type: "sticker",
            data: { file: message.sticker.file_id, emoji: message.sticker.emoji },
        });
    }
    if (message.location) {
        segments.push({
            type: "location",
            data: { latitude: message.location.latitude, longitude: message.location.longitude },
        });
    }
    if (message.venue) {
        segments.push({
            type: "location",
            data: {
                latitude: message.venue.location.latitude,
                longitude: message.venue.location.longitude,
                title: message.venue.title,
                address: message.venue.address,
            },
        });
    }
    if (message.contact) {
        segments.push({
            type: "contact",
            data: {
                phone_number: message.contact.phone_number,
                first_name: message.contact.first_name,
                last_name: message.contact.last_name,
                user_id: message.contact.user_id,
            },
        });
    }
    if (message.reply_to_message) {
        segments.unshift({
            type: "reply",
            data: { message_id: message.reply_to_message.message_id },
        });
    }
    return segments;
}

function appendTextSegments(
    segments: CommonTypes.Segment[],
    text: string,
    entities: readonly MessageEntity[],
    context: TelegramEventProjectorContext,
): void {
    const mentions = entities
        .filter(
            (entity): entity is Extract<MessageEntity, { type: "text_mention" }> =>
                entity.type === "text_mention",
        )
        .sort((left, right) => left.offset - right.offset);
    let offset = 0;
    for (const mention of mentions) {
        if (mention.offset < offset || mention.offset + mention.length > text.length) continue;
        const before = text.slice(offset, mention.offset);
        if (before) segments.push({ type: "text", data: { text: before } });
        segments.push({
            type: "at",
            data: {
                user_id: context.createId(mention.user.id),
                name: text.slice(mention.offset, mention.offset + mention.length),
            },
        });
        offset = mention.offset + mention.length;
    }
    const remaining = text.slice(offset);
    if (remaining) segments.push({ type: "text", data: { text: remaining } });
}
