import { CommonEvent, type CommonTypes } from "onebots";
import {
    base,
    customNotice,
    isRecord,
    numeric,
    stringValue,
    type ZulipProjectionContext,
} from "./event-base.js";
import type { ZulipBaseEvent, ZulipEvent } from "./types.js";

/** 投影 Zulip 定时消息资源事件；非本领域事件返回 undefined。 */
export function projectZulipScheduledMessageEvents(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] | undefined {
    if (event.type !== "scheduled_messages") return undefined;
    const op = stringValue(event.op);
    if (op === "add") {
        const events = scheduledMessages(event.scheduled_messages).map(message =>
            scheduledMessageNotice(event, context, "scheduled_message_created", op, message),
        );
        return events.length ? events : [customNotice(event, context)];
    }
    if (op === "update" && isRecord(event.scheduled_message)) {
        const id = numeric(event.scheduled_message.scheduled_message_id);
        if (id !== undefined) {
            return [
                scheduledMessageNotice(
                    event,
                    context,
                    "scheduled_message_updated",
                    op,
                    event.scheduled_message,
                ),
            ];
        }
    }
    const id = numeric(event.scheduled_message_id);
    if (op === "remove" && id !== undefined) {
        return [
            scheduledMessageNotice(event, context, "scheduled_message_removed", op, {
                scheduled_message_id: id,
            }),
        ];
    }
    return [customNotice(event, context)];
}

function scheduledMessages(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.filter(item => isRecord(item) && numeric(item.scheduled_message_id) !== undefined);
}

function scheduledMessageNotice(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
    noticeType: CommonEvent.NoticeType,
    op: string,
    message: Record<string, unknown>,
): CommonEvent.Notice<ZulipEvent> {
    const id = numeric(message.scheduled_message_id) ?? 0;
    const resource: CommonTypes.Resource = {
        ...message,
        type: "scheduled_message",
        id: context.createId(id),
    };
    return {
        ...base(event, context),
        id: context.createId(`event:${event.id}:${id}`),
        type: "notice",
        notice_type: noticeType,
        sub_type: op,
        resource,
        extensions: { zulip: event },
    };
}
