import { RecentEventDeduplicator } from "onebots";
import { FeishuError } from "./errors.js";
import { isFeishuEvent } from "./guards.js";
import type { FeishuEvent } from "./types.js";

/**
 * 飞书事件的 canonical 入口。
 *
 * event_id 只在同步投递完整成功后提交，确保上游重投可以恢复一次失败的处理。
 */
export class FeishuEventIngress {
    private readonly receivedEvents = new RecentEventDeduplicator<string>();

    ingest(event: unknown, dispatch: (event: FeishuEvent) => void): FeishuEvent | undefined {
        if (!isFeishuEvent(event)) {
            throw new FeishuError("飞书事件缺少有效的 2.0 header", {
                code: "FEISHU_INVALID_EVENT",
                details: event,
            });
        }

        const eventId = event.header.event_id;
        if (eventId && this.receivedEvents.has(eventId)) return undefined;

        dispatch(event);
        if (eventId) this.receivedEvents.commit(eventId);
        return event;
    }
}
