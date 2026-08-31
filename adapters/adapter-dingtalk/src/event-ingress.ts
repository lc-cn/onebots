import { RecentEventDeduplicator } from "onebots";
import type { DingTalkEvent, DingTalkRobotMessage } from "./types.js";

/** 钉钉 Stream、Webhook 与 manual 接入共用的成功提交去重窗口。 */
export class DingTalkEventIngress {
    private readonly receivedEvents = new RecentEventDeduplicator<string>();

    deliverRobot(message: DingTalkRobotMessage, dispatch: () => void): boolean {
        return this.deliver(`message:${message.msgId}`, dispatch);
    }

    deliverEvent(event: DingTalkEvent, dispatch: () => void): boolean {
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

    private deliver(key: string, dispatch: () => void): boolean {
        if (this.receivedEvents.has(key)) return false;
        dispatch();
        this.receivedEvents.commit(key);
        return true;
    }
}
