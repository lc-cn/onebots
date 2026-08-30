import { RecentEventDeduplicator } from "onebots";
import { ZulipError } from "./errors.js";
import type { ZulipEvent } from "./types.js";

/**
 * Event Queue 与 manual 接入共用的 canonical 事件入口。
 *
 * 事件 ID 只在全部业务监听器同步完成后提交，确保监听器异常时服务端队列或
 * 外部事件代理可以重投同一事件，而不会被本地去重窗口提前吞掉。
 */
export class ZulipEventIngress {
    private readonly receivedEvents = new RecentEventDeduplicator<number>();

    ingest(event: unknown, dispatch: (event: ZulipEvent) => void): boolean {
        if (!isZulipEvent(event)) {
            throw new ZulipError("Zulip 原始事件必须包含有效的 id 与 type", {
                code: "ZULIP_INVALID_EVENT",
                details: event,
            });
        }
        if (this.receivedEvents.has(event.id)) return false;

        dispatch(event);
        this.receivedEvents.commit(event.id);
        return true;
    }
}

function isZulipEvent(value: unknown): value is ZulipEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const event = value as Record<string, unknown>;
    return (
        Number.isSafeInteger(event.id) && typeof event.type === "string" && event.type.length > 0
    );
}
