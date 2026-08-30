import type { EventEmitter } from "node:events";
import { emitAllAwaited, ReliableEventIngress } from "onebots";
import { ZulipError } from "./errors.js";
import { ZULIP_EVENT_TYPES, type ZulipEvent } from "./types.js";

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(ZULIP_EVENT_TYPES);

/**
 * Event Queue 与 manual 接入共用的 canonical 事件入口。
 *
 * 事件 ID 只在全部业务监听器同步完成后提交，确保监听器异常时服务端队列或
 * 外部事件代理可以重投同一事件，而不会被本地去重窗口提前吞掉。
 */
export class ZulipEventIngress {
    private readonly ingress = new ReliableEventIngress<number>();

    ingest(
        event: unknown,
        dispatch: (event: ZulipEvent) => void | PromiseLike<void>,
    ): Promise<boolean> {
        if (!isZulipEvent(event)) {
            throw new ZulipError("Zulip 原始事件必须包含有效的 id 与 type", {
                code: "ZULIP_INVALID_EVENT",
                details: event,
            });
        }
        return this.ingress.deliver(event.id, () => dispatch(event));
    }
}

/** 投递 raw、精确类型与 canonical 视图，并在全部出口尝试后汇总失败。 */
export async function deliverZulipEvent(
    emitter: Pick<EventEmitter, "rawListeners">,
    event: ZulipEvent,
): Promise<void> {
    const deliveries = [
        emitAllAwaited(emitter, "raw_event", event),
        ...(EVENT_TYPE_SET.has(event.type) ? [emitAllAwaited(emitter, event.type, event)] : []),
        emitAllAwaited(emitter, "event", event),
    ];
    const results = await Promise.allSettled(deliveries);
    const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map(result => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Zulip 事件存在多个投递失败");
}

function isZulipEvent(value: unknown): value is ZulipEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const event = value as Record<string, unknown>;
    return (
        Number.isSafeInteger(event.id) && typeof event.type === "string" && event.type.length > 0
    );
}
