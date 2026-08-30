import { CommonEvent, sha256Json, type CommonTypes } from "onebots";
import type {
    WhatsAppGroupWebhookEntry,
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
        events.push(
            message.reaction
                ? projectReaction(message, change, context)
                : message.pin
                  ? projectPin(message, change, context)
                  : projectMessage(message, change.value, change, context),
        );
    }
    for (const status of change.value.statuses || []) {
        events.push(projectStatus(status, change.value, metadata, change, context));
    }
    for (const group of change.value.groups || []) {
        events.push(...projectGroupEntry(group, change, context));
    }
    if (!events.length) events.push(projectCustom(entryId, change, context));
    return events;
}

function projectReaction(
    message: WhatsAppMessageEvent,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Notice<WhatsAppWebhookChange> {
    const reaction = message.reaction!;
    const group = message.group_id
        ? { id: context.createId(message.group_id), name: message.group_id }
        : undefined;
    return {
        ...base(message.id, message.timestamp, change, context),
        type: "notice",
        notice_type: reaction.emoji ? "reaction_added" : "reaction_removed",
        message_id: context.createId(reaction.message_id),
        user: { id: context.createId(message.from), name: message.from },
        group,
        extensions: { whatsapp: { emoji: reaction.emoji } },
    };
}

function projectPin(
    message: WhatsAppMessageEvent,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Notice<WhatsAppWebhookChange> {
    const pin = message.pin!;
    return {
        ...base(message.id, message.timestamp, change, context),
        type: "notice",
        notice_type: "custom",
        message_id: context.createId(pin.message_id),
        user: { id: context.createId(message.from), name: message.from },
        group: message.group_id
            ? { id: context.createId(message.group_id), name: message.group_id }
            : undefined,
        extensions: { whatsapp: { pin } },
    };
}

function projectMessage(
    message: WhatsAppMessageEvent,
    value: WhatsAppWebhookValue,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Message<WhatsAppWebhookChange> {
    const contact = value.contacts?.find(
        item => item.user_id === message.from || item.wa_id === message.from,
    );
    const group = message.group_id
        ? { id: context.createId(message.group_id), name: message.group_id }
        : undefined;
    return {
        ...base(message.id, message.timestamp, change, context),
        type: "message",
        message_type: group ? "group" : "private",
        sender: {
            id: context.createId(message.from),
            name: contact?.profile.name || contact?.username || message.from,
        },
        group,
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
    value: WhatsAppWebhookValue,
    metadata: WhatsAppWebhookMetadata | undefined,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Notice<WhatsAppWebhookChange> {
    const participantId = status.recipient_participant_user_id;
    const groupId = status.group_id || (participantId ? status.recipient_id : undefined);
    const contact = participantId
        ? value.contacts?.find(
              item => item.user_id === participantId || item.wa_id === participantId,
          )
        : undefined;
    return {
        ...base(
            `${status.id}:${status.status}:${status.timestamp}`,
            status.timestamp,
            change,
            context,
        ),
        type: "notice",
        notice_type: status.status === "deleted" ? "message_deleted" : "message_status",
        message_id: context.createId(status.id),
        user: {
            id: context.createId(participantId || status.recipient_id),
            name:
                contact?.profile.name || contact?.username || participantId || status.recipient_id,
        },
        group: groupId ? { id: context.createId(groupId), name: groupId } : undefined,
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

function projectGroupEntry(
    entry: WhatsAppGroupWebhookEntry,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): Array<CommonEvent.Event<WhatsAppWebhookChange>> {
    const group = { id: context.createId(entry.group_id), name: groupName(entry) };
    const shared = {
        ...base(
            `${entry.group_id}:${entry.type}:${groupEntryIdentity(entry)}`,
            entry.timestamp,
            change,
            context,
        ),
        group,
        extensions: { whatsapp: { group_update: entry } },
    };
    if (entry.type === "group_add_participants") {
        return (entry.added_participants || []).map(participant => ({
            ...shared,
            id: context.createId(
                `${entry.group_id}:${entry.type}:${participant.wa_id}:${entry.timestamp}`,
            ),
            type: "notice",
            notice_type: "group_increase",
            user: { id: context.createId(participant.wa_id), name: participant.wa_id },
        }));
    }
    if (entry.type === "group_remove_participants") {
        return (entry.removed_participants || []).map(participant => ({
            ...shared,
            id: context.createId(
                `${entry.group_id}:${entry.type}:${participant.input}:${entry.timestamp}`,
            ),
            type: "notice",
            notice_type: "group_decrease",
            user: { id: context.createId(participant.input), name: participant.input },
        }));
    }
    if (entry.type === "group_join_request_created" && entry.wa_id && entry.join_request_id) {
        return [
            {
                ...shared,
                type: "request",
                request_type: "group",
                sub_type: "join_request",
                user: { id: context.createId(entry.wa_id), name: entry.wa_id },
                flag: entry.join_request_id,
            },
        ];
    }
    return [{ ...shared, type: "notice", notice_type: "custom" }];
}

function groupName(entry: WhatsAppGroupWebhookEntry): string {
    if (entry.type === "group_create") return entry.subject || entry.group_id;
    if (entry.type === "group_settings_update" && entry.group_subject?.update_successful) {
        return entry.group_subject.text || entry.group_id;
    }
    return entry.group_id;
}

function groupEntryIdentity(entry: WhatsAppGroupWebhookEntry): string {
    if ("request_id" in entry && typeof entry.request_id === "string" && entry.request_id) {
        return entry.request_id;
    }
    if (
        "join_request_id" in entry &&
        typeof entry.join_request_id === "string" &&
        entry.join_request_id
    ) {
        return entry.join_request_id;
    }
    return sha256Json(entry);
}

function projectCustom(
    entryId: string,
    change: WhatsAppWebhookChange,
    context: WhatsAppProjectionContext,
): CommonEvent.Notice<WhatsAppWebhookChange> {
    const identity = sha256Json({ entry_id: entryId, change });
    return {
        ...base(`${entryId}:${change.field}:${identity}`, Date.now(), change, context),
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
    const numeric = typeof timestamp === "string" ? Number(timestamp) : timestamp;
    const milliseconds = numeric >= 1_000_000_000_000 ? numeric : numeric * 1000;
    return {
        id: context.createId(id),
        timestamp: Number.isFinite(milliseconds) ? milliseconds : Date.now(),
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
        message.interactive?.nfm_reply?.body ||
        message.button?.text ||
        ""
    );
}
