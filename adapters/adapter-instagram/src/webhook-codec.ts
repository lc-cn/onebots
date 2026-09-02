import type { MetaWebhookCodec, MetaWebhookDelivery } from "@onebots/meta";
import { sha256Json } from "onebots";
import { InstagramError } from "./errors.js";
import {
    INSTAGRAM_EVENT_TYPES,
    type InstagramActor,
    type InstagramAttachment,
    type InstagramChange,
    type InstagramEntry,
    type InstagramEvent,
    type InstagramEventType,
    type InstagramMessage,
    type InstagramMessagingItem,
    type InstagramWebhookEnvelope,
} from "./types.js";
import {
    assertNumericMetaId,
    optionalString,
    requireArray,
    requireNumber,
    requireRecord,
    requireString,
} from "./validation.js";

const EVENT_TYPE_SET = new Set<string>(INSTAGRAM_EVENT_TYPES);

/** 将 Instagram webhook batch 严格展开为可独立去重和提交的事件。 */
export class InstagramWebhookCodec implements MetaWebhookCodec<
    InstagramEvent,
    InstagramWebhookEnvelope
> {
    private readonly enabled?: ReadonlySet<InstagramEventType>;

    constructor(
        private readonly instagramUserId: string,
        eventTypes?: readonly InstagramEventType[],
    ) {
        assertNumericMetaId(instagramUserId, "instagram_user_id");
        if (eventTypes?.some(type => !EVENT_TYPE_SET.has(type))) {
            invalid("event_types 包含未知 Instagram 事件");
        }
        this.enabled = eventTypes?.length ? new Set(eventTypes) : undefined;
    }

    parse(value: unknown): InstagramWebhookEnvelope {
        const root = requireRecord(value, "webhook");
        if (root.object !== "instagram") {
            invalid("Instagram webhook.object 必须是 instagram");
        }
        const entries = requireArray(root.entry, "webhook.entry").map((entry, index) =>
            parseEntry(entry, `webhook.entry[${index}]`),
        );
        if (!entries.length) invalid("Instagram webhook.entry 不能为空");
        if (entries.some(entry => entry.id !== this.instagramUserId)) {
            invalid("Instagram webhook entry.id 与配置 instagram_user_id 不匹配");
        }
        return { object: "instagram", entry: entries, raw: root };
    }

    expand(
        envelope: InstagramWebhookEnvelope,
    ): MetaWebhookDelivery<InstagramEvent, InstagramWebhookEnvelope>[] {
        const deliveries: MetaWebhookDelivery<InstagramEvent, InstagramWebhookEnvelope>[] = [];
        for (const entry of envelope.entry) {
            for (const [source, items] of [
                ["messaging", entry.messaging],
                ["standby", entry.standby],
            ] as const) {
                for (const item of items) {
                    const eventType = classify(item);
                    if (this.enabled && !this.enabled.has(eventType)) continue;
                    const event: InstagramEvent = {
                        event_type: eventType,
                        source,
                        instagram_user_id: entry.id,
                        entry_time: entry.time,
                        messaging: item,
                    };
                    deliveries.push({
                        id: deliveryIdentity(event),
                        event,
                        rawEnvelope: envelope,
                    });
                }
            }
            for (const change of entry.changes) {
                if (this.enabled && !this.enabled.has("change")) continue;
                const event: InstagramEvent = {
                    event_type: "change",
                    source: "change",
                    instagram_user_id: entry.id,
                    entry_time: entry.time,
                    change,
                };
                deliveries.push({
                    id: `change:${entry.id}:${entry.time}:${change.field}:${sha256Json(change.value)}`,
                    event,
                    rawEnvelope: envelope,
                });
            }
        }
        return deliveries;
    }
}

function parseEntry(value: unknown, field: string): InstagramEntry {
    const raw = requireRecord(value, field);
    const id = assertNumericMetaId(raw.id, `${field}.id`);
    const time = requireTimestamp(raw.time, `${field}.time`);
    const messaging = parseMessagingArray(raw.messaging, `${field}.messaging`);
    const standby = parseMessagingArray(raw.standby, `${field}.standby`);
    const changes = parseEntryChange(raw, field);
    if (!messaging.length && !standby.length && !changes.length) {
        invalid(`${field} 没有 messaging、standby 或 field/value 事件`);
    }
    return { id, time, messaging, standby, changes, raw };
}

function parseEntryChange(raw: Record<string, unknown>, field: string): InstagramChange[] {
    if (raw.field === undefined && raw.value === undefined) return [];
    if (raw.field === undefined || raw.value === undefined) {
        invalid(`${field}.field 与 ${field}.value 必须同时存在`);
    }
    return [
        {
            field: requireString(raw.field, `${field}.field`),
            value: requireRecord(raw.value, `${field}.value`),
        },
    ];
}

function parseMessagingArray(value: unknown, field: string): InstagramMessagingItem[] {
    if (value === undefined) return [];
    return requireArray(value, field).map((item, index) =>
        parseMessagingItem(item, `${field}[${index}]`),
    );
}

function parseMessagingItem(value: unknown, field: string): InstagramMessagingItem {
    const raw = requireRecord(value, field);
    const item: InstagramMessagingItem = {
        sender: parseActor(raw.sender, `${field}.sender`),
        recipient: parseActor(raw.recipient, `${field}.recipient`),
        timestamp: requireTimestamp(raw.timestamp, `${field}.timestamp`),
        raw,
    };
    if (raw.message !== undefined) item.message = parseMessage(raw.message, `${field}.message`);
    for (const key of [
        "message_edit",
        "reaction",
        "postback",
        "read",
        "referral",
        "optin",
        "pass_thread_control",
        "take_thread_control",
        "request_thread_control",
    ] as const) {
        if (raw[key] !== undefined) item[key] = requireRecord(raw[key], `${field}.${key}`);
    }
    validateKnownPayloads(item, field);
    if (classify(item) === "unknown" && Object.keys(raw).length <= 3) {
        invalid(`${field} 缺少 Instagram 事件 payload`);
    }
    return item;
}

function parseActor(value: unknown, field: string): InstagramActor {
    const actor = requireRecord(value, field);
    return { id: assertNumericMetaId(actor.id, `${field}.id`) };
}

function parseMessage(value: unknown, field: string): InstagramMessage {
    const raw = requireRecord(value, field);
    const message: InstagramMessage = {
        mid: requireString(raw.mid, `${field}.mid`),
        text: optionalString(raw.text, `${field}.text`),
        is_echo: optionalBoolean(raw.is_echo, `${field}.is_echo`),
        is_deleted: optionalBoolean(raw.is_deleted, `${field}.is_deleted`),
        is_self: optionalBoolean(raw.is_self, `${field}.is_self`),
        is_unsupported: optionalBoolean(raw.is_unsupported, `${field}.is_unsupported`),
    };
    if (raw.attachments !== undefined) {
        message.attachments = requireArray(raw.attachments, `${field}.attachments`).map(
            (item, index) => parseAttachment(item, `${field}.attachments[${index}]`),
        );
    }
    if (raw.quick_reply !== undefined) {
        const quickReply = requireRecord(raw.quick_reply, `${field}.quick_reply`);
        message.quick_reply = {
            payload: requireString(quickReply.payload, `${field}.quick_reply.payload`),
        };
    }
    if (raw.reply_to !== undefined) {
        message.reply_to = requireRecord(raw.reply_to, `${field}.reply_to`);
    }
    if (raw.referral !== undefined) {
        message.referral = requireRecord(raw.referral, `${field}.referral`);
    }
    return message;
}

function parseAttachment(value: unknown, field: string): InstagramAttachment {
    const raw = requireRecord(value, field);
    return {
        type: requireString(raw.type, `${field}.type`),
        payload: requireRecord(raw.payload, `${field}.payload`),
    };
}

function validateKnownPayloads(item: InstagramMessagingItem, field: string): void {
    if (item.message_edit) {
        requireString(item.message_edit.mid, `${field}.message_edit.mid`);
        requireString(item.message_edit.text, `${field}.message_edit.text`);
        const count = requireNumber(item.message_edit.num_edit, `${field}.message_edit.num_edit`);
        if (!Number.isSafeInteger(count) || count < 1) {
            invalid(`${field}.message_edit.num_edit 必须是正安全整数`);
        }
    }
    if (item.reaction) {
        requireString(item.reaction.mid, `${field}.reaction.mid`);
        const action = requireString(item.reaction.action, `${field}.reaction.action`);
        if (action !== "react" && action !== "unreact") {
            invalid(`${field}.reaction.action 必须是 react 或 unreact`);
        }
        optionalString(item.reaction.emoji, `${field}.reaction.emoji`);
    }
    if (item.postback) {
        requireString(item.postback.mid, `${field}.postback.mid`);
        requireString(item.postback.title, `${field}.postback.title`);
        requireString(item.postback.payload, `${field}.postback.payload`);
    }
    if (item.read) requireString(item.read.mid, `${field}.read.mid`);
    if (item.referral) {
        requireString(item.referral.ref, `${field}.referral.ref`);
        requireString(item.referral.source, `${field}.referral.source`);
        requireString(item.referral.type, `${field}.referral.type`);
    }
}

function classify(item: InstagramMessagingItem): InstagramEventType {
    if (item.message?.is_deleted) return "message_deleted";
    if (item.message?.is_unsupported) return "message_unsupported";
    if (item.message) return item.message.is_echo ? "message_echo" : "message";
    if (item.message_edit) return "message_edit";
    if (item.reaction) return "reaction";
    if (item.postback) return "postback";
    if (item.read) return "read";
    if (item.referral) return "referral";
    if (item.optin) return "optin";
    if (item.pass_thread_control || item.take_thread_control || item.request_thread_control) {
        return "handover";
    }
    return "unknown";
}

function deliveryIdentity(event: InstagramEvent): string {
    const item = event.messaging;
    if (!item) return sha256Json(event);
    const prefix = `${event.instagram_user_id}:${event.source}`;
    if (item.message) return `${prefix}:message:${item.message.mid}:${event.event_type}`;
    if (item.message_edit) {
        return `${prefix}:edit:${item.message_edit.mid}:${item.message_edit.num_edit}`;
    }
    if (item.reaction) {
        return `${prefix}:reaction:${item.reaction.mid}:${item.sender.id}:${item.reaction.action}`;
    }
    if (item.postback) return `${prefix}:postback:${item.postback.mid}:${item.sender.id}`;
    if (item.read) return `${prefix}:read:${item.read.mid}:${item.sender.id}`;
    return `${prefix}:${classify(item)}:${item.timestamp}:${sha256Json(item.raw)}`;
}

function requireTimestamp(value: unknown, field: string): number {
    const timestamp = requireNumber(value, field);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        invalid(`${field} 必须是非负毫秒时间戳安全整数`);
    }
    return timestamp;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") invalid(`${field} 必须是 boolean`);
    return value;
}

function invalid(message: string): never {
    throw InstagramError.invalid(message);
}
