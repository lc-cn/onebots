import type { EventEmitter } from "node:events";
import { emitAllAwaited } from "onebots";
import type { WhatsAppClientEvents, WhatsAppWebhookEvent } from "./types.js";

export interface WhatsAppDeliveryStats {
    changes: number;
    messages: number;
    statuses: number;
    groupUpdates: number;
}

type WhatsAppEventEmitter = Pick<EventEmitter<WhatsAppClientEvents>, "rawListeners">;

/**
 * 按 Cloud API 原始批次顺序投递所有事件视图。
 *
 * 单个监听器或视图失败不会截断其余投递；全部视图完成后再传播错误，确保 Meta
 * 获得失败响应并重投，同时避免 typed handler 因较早的 raw handler 失败而漏事件。
 */
export async function deliverWhatsAppEvent(
    emitter: WhatsAppEventEmitter,
    event: WhatsAppWebhookEvent,
): Promise<WhatsAppDeliveryStats> {
    const failures: unknown[] = [];
    const attempt = async (delivery: () => Promise<void>): Promise<void> => {
        try {
            await delivery();
        } catch (error) {
            failures.push(error);
        }
    };

    await attempt(() => emitAllAwaited(emitter, "raw_event", event));
    await attempt(() => emitAllAwaited(emitter, "webhook", event));

    let changes = 0;
    let messages = 0;
    let statuses = 0;
    let groupUpdates = 0;
    for (const entry of event.entry) {
        for (const change of entry.changes) {
            changes += 1;
            await attempt(() => emitAllAwaited(emitter, "change", change, entry.id));
            for (const message of change.value.messages || []) {
                messages += 1;
                await attempt(() =>
                    emitAllAwaited(emitter, "message", message, change.value.metadata, change),
                );
            }
            for (const status of change.value.statuses || []) {
                statuses += 1;
                await attempt(() =>
                    emitAllAwaited(emitter, "status", status, change.value.metadata, change),
                );
            }
            for (const group of change.value.groups || []) {
                groupUpdates += 1;
                await attempt(() => emitAllAwaited(emitter, "group_update", group, change));
            }
        }
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
        throw new AggregateError(failures, `${failures.length} 个 WhatsApp 事件视图投递失败`);
    }
    return { changes, messages, statuses, groupUpdates };
}
