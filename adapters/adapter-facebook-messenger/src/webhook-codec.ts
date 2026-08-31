import { sha256Json } from "onebots";
import type { MetaWebhookCodec, MetaWebhookDelivery } from "@onebots/meta";
import {
    FACEBOOK_MESSENGER_EVENT_TYPES,
    type FacebookMessengerEvent,
    type FacebookMessengerEventType,
    type MessengerActor,
    type MessengerAttachment,
    type MessengerChange,
    type MessengerEntry,
    type MessengerMessage,
    type MessengerMessagingItem,
    type MessengerWebhookEnvelope,
} from "./types.js";
import { FacebookMessengerError } from "./errors.js";
import {
    assertNumericMetaId,
    optionalString,
    requireArray,
    requireNumber,
    requireRecord,
    requireString,
} from "./validation.js";

const EVENT_TYPE_SET = new Set<string>(FACEBOOK_MESSENGER_EVENT_TYPES);

/** 将 Page webhook batch 严格展开为可独立去重和提交的 Messenger 事件。 */
export class FacebookMessengerWebhookCodec implements MetaWebhookCodec<
    FacebookMessengerEvent,
    MessengerWebhookEnvelope
> {
    private readonly enabled?: ReadonlySet<FacebookMessengerEventType>;

    constructor(
        private readonly pageId: string,
        eventTypes?: readonly FacebookMessengerEventType[],
    ) {
        assertNumericMetaId(pageId, "page_id");
        if (eventTypes?.some(type => !EVENT_TYPE_SET.has(type))) {
            invalid("event_types 包含未知 Facebook Messenger 事件");
        }
        this.enabled = eventTypes?.length ? new Set(eventTypes) : undefined;
    }

    parse(value: unknown): MessengerWebhookEnvelope {
        const root = requireRecord(value, "webhook");
        if (root.object !== "page") {
            invalid("Facebook Messenger webhook.object 必须是 page");
        }
        const entries = requireArray(root.entry, "webhook.entry").map((entry, index) =>
            parseEntry(entry, `webhook.entry[${index}]`),
        );
        if (!entries.length) invalid("Facebook Messenger webhook.entry 不能为空");
        if (entries.some(entry => entry.id !== this.pageId)) {
            invalid("Facebook Messenger webhook entry.id 与配置 page_id 不匹配");
        }
        return { object: "page", entry: entries, raw: root };
    }

    expand(
        envelope: MessengerWebhookEnvelope,
    ): MetaWebhookDelivery<FacebookMessengerEvent, MessengerWebhookEnvelope>[] {
        const deliveries: MetaWebhookDelivery<FacebookMessengerEvent, MessengerWebhookEnvelope>[] =
            [];
        for (const entry of envelope.entry) {
            for (const [source, items] of [
                ["messaging", entry.messaging],
                ["standby", entry.standby],
            ] as const) {
                for (const item of items) {
                    const eventType = classify(item);
                    if (this.enabled && !this.enabled.has(eventType)) continue;
                    const event: FacebookMessengerEvent = {
                        event_type: eventType,
                        source,
                        page_id: entry.id,
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
                const event: FacebookMessengerEvent = {
                    event_type: "change",
                    source: "change",
                    page_id: entry.id,
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

function parseEntry(value: unknown, field: string): MessengerEntry {
    const raw = requireRecord(value, field);
    const id = assertNumericMetaId(raw.id, `${field}.id`);
    const time = requireTimestamp(raw.time, `${field}.time`);
    const messaging = parseMessagingArray(raw.messaging, `${field}.messaging`);
    const standby = parseMessagingArray(raw.standby, `${field}.standby`);
    const changes = parseChanges(raw.changes, `${field}.changes`);
    if (!messaging.length && !standby.length && !changes.length) {
        invalid(`${field} 没有 messaging、standby 或 changes 事件`);
    }
    return { id, time, messaging, standby, changes, raw };
}

function parseMessagingArray(value: unknown, field: string): MessengerMessagingItem[] {
    if (value === undefined) return [];
    return requireArray(value, field).map((item, index) =>
        parseMessagingItem(item, `${field}[${index}]`),
    );
}

function parseMessagingItem(value: unknown, field: string): MessengerMessagingItem {
    const raw = requireRecord(value, field);
    const item: MessengerMessagingItem = {
        sender: parseActor(raw.sender, `${field}.sender`),
        recipient: parseActor(raw.recipient, `${field}.recipient`),
        timestamp: requireTimestamp(raw.timestamp, `${field}.timestamp`),
        raw,
    };
    if (raw.message !== undefined) item.message = parseMessage(raw.message, `${field}.message`);
    for (const key of [
        "delivery",
        "read",
        "postback",
        "reaction",
        "message_edit",
        "optin",
        "account_linking",
        "referral",
        "pass_thread_control",
        "take_thread_control",
        "request_thread_control",
        "policy_enforcement",
        "feedback",
        "game_play",
    ] as const) {
        if (raw[key] !== undefined) item[key] = requireRecord(raw[key], `${field}.${key}`);
    }
    validateKnownPayloads(item, field);
    if (classify(item) === "unknown" && Object.keys(raw).length <= 3) {
        invalid(`${field} 缺少 Messenger 事件 payload`);
    }
    return item;
}

function parseActor(value: unknown, field: string): MessengerActor {
    const actor = requireRecord(value, field);
    return { id: assertNumericMetaId(actor.id, `${field}.id`) };
}

function parseMessage(value: unknown, field: string): MessengerMessage {
    const raw = requireRecord(value, field);
    const mid = requireString(raw.mid, `${field}.mid`);
    const text = optionalString(raw.text, `${field}.text`);
    const isEcho = raw.is_echo;
    if (isEcho !== undefined && typeof isEcho !== "boolean") {
        invalid(`${field}.is_echo 必须是 boolean`);
    }
    const attachments =
        raw.attachments === undefined
            ? undefined
            : requireArray(raw.attachments, `${field}.attachments`).map((item, index) =>
                  parseAttachment(item, `${field}.attachments[${index}]`),
              );
    const quickReply = raw.quick_reply;
    const replyTo = raw.reply_to;
    return {
        mid,
        text,
        is_echo: isEcho as boolean | undefined,
        app_id: raw.app_id === undefined ? undefined : requireNumber(raw.app_id, `${field}.app_id`),
        metadata: optionalString(raw.metadata, `${field}.metadata`),
        attachments,
        quick_reply:
            quickReply === undefined
                ? undefined
                : {
                      payload: requireString(
                          requireRecord(quickReply, `${field}.quick_reply`).payload,
                          `${field}.quick_reply.payload`,
                      ),
                  },
        reply_to:
            replyTo === undefined
                ? undefined
                : {
                      mid: requireString(
                          requireRecord(replyTo, `${field}.reply_to`).mid,
                          `${field}.reply_to.mid`,
                      ),
                  },
        referral:
            raw.referral === undefined
                ? undefined
                : requireRecord(raw.referral, `${field}.referral`),
    };
}

function parseAttachment(value: unknown, field: string): MessengerAttachment {
    const raw = requireRecord(value, field);
    return {
        type: requireString(raw.type, `${field}.type`),
        payload: requireRecord(raw.payload, `${field}.payload`),
    };
}

function parseChanges(value: unknown, field: string): MessengerChange[] {
    if (value === undefined) return [];
    return requireArray(value, field).map((item, index) => {
        const change = requireRecord(item, `${field}[${index}]`);
        return {
            field: requireString(change.field, `${field}[${index}].field`),
            value: requireRecord(change.value, `${field}[${index}].value`),
        };
    });
}

function validateKnownPayloads(item: MessengerMessagingItem, field: string): void {
    if (item.delivery) {
        const mids = requireArray(item.delivery.mids, `${field}.delivery.mids`);
        if (!mids.length || mids.some(mid => typeof mid !== "string" || !mid)) {
            invalid(`${field}.delivery.mids 必须是非空 message ID 数组`);
        }
        requireNumber(item.delivery.watermark, `${field}.delivery.watermark`);
    }
    if (item.read) requireNumber(item.read.watermark, `${field}.read.watermark`);
    if (item.postback) requireString(item.postback.payload, `${field}.postback.payload`);
    if (item.reaction) {
        requireString(item.reaction.mid, `${field}.reaction.mid`);
        const action = requireString(item.reaction.action, `${field}.reaction.action`);
        if (action !== "react" && action !== "unreact") {
            invalid(`${field}.reaction.action 必须是 react 或 unreact`);
        }
        optionalString(item.reaction.emoji, `${field}.reaction.emoji`);
    }
    if (item.message_edit) {
        requireString(item.message_edit.mid, `${field}.message_edit.mid`);
        requireString(item.message_edit.text, `${field}.message_edit.text`);
        requireNumber(item.message_edit.num_edit, `${field}.message_edit.num_edit`);
    }
}

function invalid(message: string): never {
    throw FacebookMessengerError.invalid(message);
}

function requireTimestamp(value: unknown, field: string): number {
    const timestamp = requireNumber(value, field);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        invalid(`${field} 必须是非负毫秒时间戳安全整数`);
    }
    return timestamp;
}

function classify(item: MessengerMessagingItem): FacebookMessengerEventType {
    if (item.message) return item.message.is_echo ? "message_echo" : "message";
    if (item.message_edit) return "message_edit";
    if (item.delivery) return "delivery";
    if (item.read) return "read";
    if (item.reaction) return "reaction";
    if (item.postback) return "postback";
    if (item.referral) return "referral";
    if (item.optin) return "optin";
    if (item.account_linking) return "account_linking";
    if (item.pass_thread_control || item.take_thread_control || item.request_thread_control) {
        return "handover";
    }
    if (item.policy_enforcement) return "policy_enforcement";
    if (item.feedback) return "feedback";
    if (item.game_play) return "game_play";
    return "unknown";
}

function deliveryIdentity(event: FacebookMessengerEvent): string {
    const item = event.messaging;
    if (!item) return sha256Json(event);
    const prefix = `${event.page_id}:${event.source}`;
    if (item.message) return `${prefix}:message:${item.message.mid}`;
    if (item.message_edit)
        return `${prefix}:edit:${item.message_edit.mid}:${item.message_edit.num_edit}`;
    if (item.delivery) {
        return `${prefix}:delivery:${(item.delivery.mids as string[]).join(",")}:${item.delivery.watermark}`;
    }
    if (item.read) return `${prefix}:read:${item.sender.id}:${item.read.watermark}`;
    if (item.reaction) {
        return `${prefix}:reaction:${item.sender.id}:${item.reaction.mid}:${item.reaction.action}:${item.timestamp}`;
    }
    return `${prefix}:${event.event_type}:${item.sender.id}:${item.timestamp}:${sha256Json(item.raw)}`;
}
