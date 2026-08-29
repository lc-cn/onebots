import type { EventEmitter } from "node:events";
import type { NormalizedChatEvent } from "./protocol/chat-event.js";
import type { OnTextListener } from "./protocol/chat-event.js";
import { mapInboundWirePacket } from "./protocol/inbound-mapper.js";
import { GatewayFault } from "./internal/errors.js";

export interface RegexBinding {
    pattern: RegExp;
    listener: OnTextListener;
}

/** 维护有界事件缓存，供媒体下载动作按 message_id 定位原始句柄。 */
export function rememberRecentMessage(
    cache: Map<string, NormalizedChatEvent>,
    event: NormalizedChatEvent,
): void {
    const messageId = String(event.id ?? event.seq ?? "");
    if (!messageId) return;
    cache.set(messageId, event);
    if (cache.size <= 256) return;
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
}

export function resolveRecentMedia(
    cache: ReadonlyMap<string, NormalizedChatEvent>,
    messageId: string,
    itemIndex?: number,
): NormalizedChatEvent {
    const message = cache.get(messageId);
    if (!message)
        throw new GatewayFault("MESSAGE_NOT_CACHED", `最近事件缓存中不存在消息 ${messageId}`);
    if (itemIndex === undefined) return message;
    const item = message.raw.item_list?.[itemIndex];
    if (!item)
        throw new GatewayFault(
            "MESSAGE_ITEM_NOT_FOUND",
            `消息 ${messageId} 不存在 item ${itemIndex}`,
        );
    return mapInboundWirePacket({ ...message.raw, item_list: [item] });
}

/** 逐个等待监听器，并把监听异常转成 listener_error 而非终止接收循环。 */
export async function emitInboundSafely(
    emitter: EventEmitter,
    eventName: string,
    event: NormalizedChatEvent,
): Promise<void> {
    for (const listener of emitter.rawListeners(eventName)) {
        try {
            await Reflect.apply(listener, emitter, [event]);
        } catch (error) {
            reportListenerError(emitter, eventName, error);
        }
    }
}

export function reportListenerError(
    emitter: EventEmitter,
    eventName: string,
    error: unknown,
): void {
    try {
        emitter.emit("listener_error", { event: eventName, error });
    } catch {
        // listener_error 本身不得再次破坏消息接收；宿主应注册可靠的日志监听器。
    }
}

export async function runTextBindings(
    emitter: EventEmitter,
    bindings: readonly RegexBinding[],
    event: NormalizedChatEvent,
): Promise<void> {
    if (!event.text) return;
    for (const { pattern, listener } of bindings) {
        const match = pattern.exec(event.text);
        pattern.lastIndex = 0;
        if (!match) continue;
        try {
            await listener(event, match);
        } catch (error) {
            reportListenerError(emitter, "text_match", error);
        }
    }
}
