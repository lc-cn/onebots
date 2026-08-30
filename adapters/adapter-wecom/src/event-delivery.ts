import type { EventEmitter } from "node:events";
import { emitAllAwaited } from "onebots";
import type { WeComEvent } from "./types.js";

/**
 * 将同一企业微信事件交付给无损视图与分类视图。
 *
 * 两个视图是独立的 SDK 契约：任一视图失败时仍须完成另一视图，随后由调用方
 * 统一拒绝 ACK 并保留重投机会。
 */
export async function deliverWeComEvent(
    emitter: Pick<EventEmitter, "rawListeners">,
    event: WeComEvent,
): Promise<void> {
    const failures: unknown[] = [];
    try {
        await emitAllAwaited(emitter, "raw_event", event);
    } catch (error) {
        failures.push(error);
    }
    try {
        await emitAllAwaited(emitter, event.MsgType === "event" ? "event" : "message", event);
    } catch (error) {
        failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
        throw new AggregateError(failures, "企业微信事件存在多个投递失败");
    }
}
