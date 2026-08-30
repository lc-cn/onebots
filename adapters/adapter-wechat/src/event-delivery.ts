import type { EventEmitter } from "node:events";
import { emitAllAwaited } from "onebots";
import type { WechatClientEvents, WechatIncomingMessage } from "./types.js";

type WechatEmitter = EventEmitter<WechatClientEvents>;

/**
 * 将公众号消息交付给无损、分类与精确事件视图。
 *
 * 各视图是独立 SDK 契约；全部尝试后统一抛错，确保失败 ACK 不会以漏投其他出口为代价。
 */
export async function deliverWechatEvent(
    emitter: WechatEmitter,
    message: WechatIncomingMessage,
): Promise<void> {
    const deliveries: Array<PromiseSettledResult<void>> = [];
    deliveries.push(
        ...(await Promise.allSettled([
            emitAllAwaited(emitter, "raw_event", message),
            emitAllAwaited(emitter, message.MsgType === "event" ? "event" : "message", message),
            ...(message.MsgType === "event" && message.Event
                ? [emitAllAwaited(emitter, `event.${message.Event.toLowerCase()}`, message)]
                : []),
        ])),
    );
    const failures = deliveries
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map(result => result.reason as unknown);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
        throw new AggregateError(failures, "微信公众号事件存在多个投递失败");
    }
}
