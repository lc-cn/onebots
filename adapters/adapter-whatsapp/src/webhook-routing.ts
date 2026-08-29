import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppIngestResult,
    WhatsAppWebhookEvent,
    WhatsAppWebhookRequest,
} from "./types.js";

export interface WhatsAppWebhookDelivery {
    phoneNumberId: string;
    event: WhatsAppWebhookEvent;
}

/** 维护 Phone Number 到 Client 的唯一映射，并聚合一次 App Webhook 的处理结果。 */
export class WhatsAppWebhookRouter {
    private readonly clients = new Map<string, WhatsAppClient>();

    register(client: WhatsAppClient): void {
        const phoneNumberId = client.config.phone_number_id;
        if (this.clients.has(phoneNumberId)) {
            throw new WhatsAppApiError(
                `WhatsApp Phone Number ID ${phoneNumberId} 已被其他账号使用`,
                { code: "WHATSAPP_DUPLICATE_PHONE_NUMBER" },
            );
        }
        this.clients.set(phoneNumberId, client);
    }

    ingest(
        source: WhatsAppClient,
        request: WhatsAppWebhookRequest,
        onIgnored: (phoneNumberId: string, changes: number) => void = () => undefined,
    ): WhatsAppIngestResult {
        const verified = source.verifyHttp(request.body, request.signature);
        const aggregate: WhatsAppIngestResult = {
            accepted: 0,
            duplicate: true,
            changes: 0,
            messages: 0,
            statuses: 0,
            ignoredChanges: 0,
            event: verified.event,
        };
        for (const delivery of routeWhatsAppWebhook(
            verified.event,
            source.config.phone_number_id,
        )) {
            const target = this.clients.get(delivery.phoneNumberId);
            if (!target) {
                const ignored = delivery.event.entry.reduce(
                    (total, entry) => total + entry.changes.length,
                    0,
                );
                aggregate.ignoredChanges += ignored;
                aggregate.duplicate = false;
                onIgnored(delivery.phoneNumberId, ignored);
                continue;
            }
            merge(
                aggregate,
                target.ingest(
                    delivery.event,
                    `${verified.deduplicationKey}:${delivery.phoneNumberId}`,
                ),
            );
        }
        return aggregate;
    }
}

/**
 * Meta 的 App Webhook 可同时承载 WABA 下多个号码；按 change metadata 拆批，
 * 没有号码元数据的 WABA 级通知留给回调路径所属账号。
 */
export function routeWhatsAppWebhook(
    event: WhatsAppWebhookEvent,
    fallbackPhoneNumberId: string,
): WhatsAppWebhookDelivery[] {
    const deliveries = new Map<string, WhatsAppWebhookEvent["entry"]>();
    for (const entry of event.entry) {
        if (entry.changes.length === 0) append(deliveries, fallbackPhoneNumberId, entry, []);
        const grouped = new Map<string, typeof entry.changes>();
        for (const change of entry.changes) {
            const target = change.value.metadata?.phone_number_id || fallbackPhoneNumberId;
            const changes = grouped.get(target) || [];
            changes.push(change);
            grouped.set(target, changes);
        }
        for (const [phoneNumberId, changes] of grouped) {
            append(deliveries, phoneNumberId, entry, changes);
        }
    }
    if (event.entry.length === 0) deliveries.set(fallbackPhoneNumberId, []);
    return [...deliveries].map(([phoneNumberId, entry]) => ({
        phoneNumberId,
        event: { ...event, entry },
    }));
}

function append(
    deliveries: Map<string, WhatsAppWebhookEvent["entry"]>,
    phoneNumberId: string,
    entry: WhatsAppWebhookEvent["entry"][number],
    changes: WhatsAppWebhookEvent["entry"][number]["changes"],
): void {
    const entries = deliveries.get(phoneNumberId) || [];
    entries.push({ ...entry, changes });
    deliveries.set(phoneNumberId, entries);
}

function merge(aggregate: WhatsAppIngestResult, result: WhatsAppIngestResult): void {
    aggregate.accepted += result.accepted;
    aggregate.changes += result.changes;
    aggregate.messages += result.messages;
    aggregate.statuses += result.statuses;
    aggregate.duplicate = aggregate.duplicate && result.duplicate;
}
