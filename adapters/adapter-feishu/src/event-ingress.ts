import { ReliableEventIngress, sha256Json } from "onebots";
import { FeishuError } from "./errors.js";
import { isFeishuEvent } from "./guards.js";
import type { FeishuEvent } from "./types.js";

/**
 * 飞书事件的 canonical 入口。
 *
 * event_id 只在异步投递完整成功后提交，确保上游重投可以恢复一次失败的处理。
 */
export class FeishuEventIngress {
    private readonly ingress = new ReliableEventIngress<string>();

    async ingest(
        event: unknown,
        dispatch: (event: FeishuEvent) => void | Promise<void>,
    ): Promise<FeishuEvent | undefined> {
        if (!isFeishuEvent(event)) {
            throw new FeishuError("飞书事件缺少有效的 2.0 header", {
                code: "FEISHU_INVALID_EVENT",
                details: event,
            });
        }

        const eventId = event.header.event_id || `sha256:${sha256Json(event)}`;
        const delivered = await this.ingress.deliver(eventId, async () => {
            await dispatch(event);
        });
        return delivered ? event : undefined;
    }
}
