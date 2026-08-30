import { KeyedSingleFlight, RecentEventDeduplicator } from "onebots";
import type { DingTalkEvent, DingTalkRobotMessage } from "./types.js";

/** 钉钉 Stream、Webhook 与 manual 接入共用的成功提交去重窗口。 */
export class DingTalkEventIngress {
    private readonly receivedEvents = new RecentEventDeduplicator<string>();
    private readonly deliveries = new KeyedSingleFlight<string, boolean>();

    deliverRobot(
        message: DingTalkRobotMessage,
        dispatch: () => void | Promise<void>,
    ): Promise<boolean> {
        return this.deliver(`message:${message.msgId}`, dispatch);
    }

    deliverEvent(event: DingTalkEvent, dispatch: () => void | Promise<void>): Promise<boolean> {
        const nestedMessage = event.eventData.msg;
        const messageId =
            nestedMessage && typeof nestedMessage === "object" && !Array.isArray(nestedMessage)
                ? (nestedMessage as Record<string, unknown>).msgId
                : undefined;
        const key =
            typeof messageId === "string" && messageId
                ? `message:${messageId}`
                : `event:${event.eventId}`;
        return this.deliver(key, dispatch);
    }

    private deliver(key: string, dispatch: () => void | Promise<void>): Promise<boolean> {
        if (this.receivedEvents.has(key)) return Promise.resolve(false);
        return this.deliveries.run(key, async () => {
            if (this.receivedEvents.has(key)) return false;
            await dispatch();
            this.receivedEvents.commit(key);
            return true;
        });
    }
}
