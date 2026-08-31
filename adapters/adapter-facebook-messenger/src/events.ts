import { type CommonEvent, type CommonTypes } from "onebots";
import { projectWebhookMessage } from "./messages.js";
import type { FacebookMessengerDelivery, MessengerMessagingItem } from "./types.js";

export interface FacebookMessengerProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

export function projectFacebookMessengerEvent(
    delivery: FacebookMessengerDelivery,
    context: FacebookMessengerProjectionContext,
): CommonEvent.Event<unknown>[] {
    const event = delivery.event;
    const item = event.messaging;
    if (event.event_type === "message" && item?.message) {
        return [
            {
                ...base(delivery, context),
                type: "message",
                message_type: "direct",
                message_id: context.createId(item.message.mid),
                sender: { id: context.createId(item.sender.id) },
                message: projectWebhookMessage(item.message),
                raw_message: item.message.text,
                extensions: messagingExtensions(event.source, item),
            },
        ];
    }
    if (event.event_type === "message_echo" && item?.message) {
        return [
            {
                ...base(delivery, context),
                type: "notice",
                notice_type: "message_status",
                sub_type: "echo",
                message_id: context.createId(item.message.mid),
                user: { id: context.createId(item.recipient.id) },
                message: projectWebhookMessage(item.message),
                extensions: messagingExtensions(event.source, item),
            },
        ];
    }
    if (event.event_type === "message_edit" && item?.message_edit) {
        return [
            {
                ...base(delivery, context),
                type: "notice",
                notice_type: "message_updated",
                message_id: context.createId(String(item.message_edit.mid)),
                user: { id: context.createId(item.sender.id) },
                message: [{ type: "text", data: { text: String(item.message_edit.text) } }],
                extensions: messagingExtensions(event.source, item),
            },
        ];
    }
    if (event.event_type === "delivery" && item?.delivery) {
        return (item.delivery.mids as string[]).map(mid => ({
            ...base(delivery, context, `:${mid}`),
            type: "notice" as const,
            notice_type: "message_status" as const,
            sub_type: "delivered",
            message_id: context.createId(mid),
            user: { id: context.createId(item.recipient.id) },
            extensions: messagingExtensions(event.source, item),
        }));
    }
    if (event.event_type === "read" && item?.read) {
        return [
            {
                ...base(delivery, context),
                type: "notice",
                notice_type: "message_status",
                sub_type: "read",
                user: { id: context.createId(item.sender.id) },
                extensions: messagingExtensions(event.source, item),
            },
        ];
    }
    if (event.event_type === "reaction" && item?.reaction) {
        const removed = item.reaction.action === "unreact";
        return [
            {
                ...base(delivery, context),
                type: "notice",
                notice_type: removed ? "reaction_removed" : "reaction_added",
                message_id: context.createId(String(item.reaction.mid)),
                user: { id: context.createId(item.sender.id) },
                extensions: messagingExtensions(event.source, item),
            },
        ];
    }
    if (event.event_type === "postback" && item?.postback) {
        return [
            {
                ...base(delivery, context),
                type: "notice",
                notice_type: "interaction",
                sub_type: "postback",
                user: { id: context.createId(item.sender.id) },
                message_id:
                    typeof item.postback.mid === "string"
                        ? context.createId(item.postback.mid)
                        : undefined,
                extensions: messagingExtensions(event.source, item),
            },
        ];
    }
    return [
        {
            ...base(delivery, context),
            type: "notice",
            notice_type: "custom",
            sub_type: event.source === "standby" ? `standby_${event.event_type}` : event.event_type,
            user: item ? { id: context.createId(item.sender.id) } : undefined,
            extensions: item
                ? messagingExtensions(event.source, item)
                : { facebook_messenger: { change: event.change } },
        },
    ];
}

function base(
    delivery: FacebookMessengerDelivery,
    context: FacebookMessengerProjectionContext,
    suffix = "",
): CommonEvent.Base<unknown> {
    return {
        id: context.createId(`event:${delivery.id}${suffix}`),
        timestamp: delivery.event.messaging?.timestamp || delivery.event.entry_time,
        type: "custom",
        platform: "facebook-messenger",
        bot_id: context.botId,
        raw_event: delivery.rawEnvelope.raw,
    };
}

function messagingExtensions(
    source: "messaging" | "standby" | "change",
    item: MessengerMessagingItem,
): Record<string, unknown> {
    return { facebook_messenger: { source, messaging: item.raw } };
}
