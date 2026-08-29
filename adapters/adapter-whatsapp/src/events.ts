import { CommonEvent, type CommonTypes } from "onebots";
import type {
    WhatsAppMessageEvent,
    WhatsAppMessageStatusEvent,
    WhatsAppWebhookChange,
    WhatsAppWebhookEvent,
    WhatsAppWebhookMetadata,
    WhatsAppWebhookValue,
} from "./types.js";

interface WhatsAppProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 将一份 Webhook 批次完整展开，确保消息、状态和未知字段都不丢失。 */
export function projectWhatsAppWebhook(
    webhook: WhatsAppWebhookEvent,
    context: WhatsAppProjectionContext,
): Array<CommonEvent.Event<WhatsAppWebhookChange>> {
    const result: Array<CommonEvent.Event<WhatsAppWebhookChange>> = [];
    for (const entry of webhook.entry) {
        for (const change of entry.changes) {
            result.push(...projectChange(entry.id, change, context));
        }
    }
    return result;
}

function projectChange(
    entryId: string,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): Array<CommonEvent.Event<WhatsAppWebhookChange>> {
    const events: Array<CommonEvent.Event<WhatsAppWebhookChange>> = [];
    const metadata = change.value.metadata;
    for (const message of change.value.messages || []) {
        events.push(projectMessage(message, change.value, change, context));
    }
    for (const status of change.value.statuses || []) {
        events.push(projectStatus(status, metadata, change, context));
    }
    if (!events.length) events.push(projectCustom(entryId, change, context));
    return events;
}

function projectMessage(
    message: WhatsAppMessageEvent,
    value: WhatsAppWebhookValue,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Message<WhatsAppWebhookChange> {
    const contact = value.contacts?.find(item => item.wa_id === message.from);
    return {
        ...base(message.id, message.timestamp, change, context),
        type: "message",
        message_type: "private",
        sender: {
            id: context.createId(message.from),
            name: contact?.profile.name || message.from,
        },
        message_id: context.createId(message.id),
        message: projectMessageContent(message),
        raw_message: message.text?.body || interactionText(message),
        extensions: {
            whatsapp: {
                context: message.context,
                referral: message.referral,
                phone_number_id: value.metadata?.phone_number_id,
            },
        },
    };
}

export function projectMessageContent(message: WhatsAppMessageEvent): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (message.context?.id) {
        segments.push({ type: "reply", data: { message_id: message.context.id } });
    }
    if (message.text) segments.push({ type: "text", data: { text: message.text.body } });
    else if (message.image) segments.push(mediaSegment("image", message.image));
    else if (message.video) segments.push(mediaSegment("video", message.video));
    else if (message.audio) segments.push(mediaSegment("audio", message.audio));
    else if (message.document) segments.push(mediaSegment("file", message.document));
    else if (message.sticker) segments.push(mediaSegment("sticker", message.sticker));
    else if (message.location) {
        segments.push({
            type: "location",
            data: {
                latitude: message.location.latitude,
                longitude: message.location.longitude,
                name: message.location.name,
                address: message.location.address,
                url: message.location.url,
            },
        });
    } else if (message.contacts) {
        segments.push({ type: "contacts", data: { contacts: message.contacts } });
    } else if (message.reaction) {
        segments.push({ type: "reaction", data: message.reaction });
    } else if (message.interactive || message.button) {
        segments.push({
            type: "interactive",
            data: { interactive: message.interactive, button: message.button },
        });
    } else {
        segments.push({ type: "whatsapp_message", data: { message } });
    }
    return segments;
}

function projectStatus(
    status: WhatsAppMessageStatusEvent,
    metadata: WhatsAppWebhookMetadata | undefined,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Notice<WhatsAppWebhookChange> {
    return {
        ...base(
            `${status.id}:${status.status}:${status.timestamp}`,
            status.timestamp,
            change,
            context,
        ),
        type: "notice",
        notice_type: status.status === "deleted" ? "message_deleted" : "message_updated",
        message_id: context.createId(status.id),
        user: { id: context.createId(status.recipient_id), name: status.recipient_id },
        extensions: {
            whatsapp: {
                status: status.status,
                conversation: status.conversation,
                pricing: status.pricing,
                errors: status.errors,
                phone_number_id: metadata?.phone_number_id,
            },
        },
    };
}

function projectCustom(
    entryId: string,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Notice<WhatsAppWebhookChange> {
    return {
        ...base(`${entryId}:${change.field}`, Date.now(), change, context),
        type: "notice",
        notice_type: "custom",
        extensions: { whatsapp: { field: change.field, value: change.value } },
    };
}

function base(
    id: string,
    timestamp: string | number,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Base<WhatsAppWebhookChange> {
    const seconds = typeof timestamp === "string" ? Number(timestamp) : timestamp;
    return {
        id: context.createId(id),
        timestamp: Number.isFinite(seconds) ? seconds * 1000 : Date.now(),
        platform: "whatsapp",
        bot_id: context.botId,
        type: "custom",
        raw_event: change,
    };
}

function mediaSegment(
    type: string,
    media: { id: string; caption?: string; filename?: string; mime_type?: string; sha256?: string },
): CommonTypes.Segment {
    return {
        type,
        data: {
            file: media.id,
            url: `whatsapp://media/${media.id}`,
            caption: media.caption,
            name: media.filename,
            mime_type: media.mime_type,
            sha256: media.sha256,
        },
    };
}

function interactionText(message: WhatsAppMessageEvent): string {
    return (
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        message.button?.text ||
        ""
    );
}
