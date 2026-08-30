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

/** 投影当前用户拥有的定时消息、提醒等个人资源事件。 */
export function projectZulipPersonalResourceEvents(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] | undefined {
    if (event.type === "scheduled_messages") return projectScheduledMessages(event, context);
    if (event.type === "reminders") return projectReminders(event, context);
    if (event.type === "saved_snippets") return projectSavedSnippets(event, context);
    return undefined;
}

function projectSavedSnippets(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] {
    const op = stringValue(event.op);
    if ((op === "add" || op === "update") && isRecord(event.saved_snippet)) {
        if (numeric(event.saved_snippet.id) !== undefined) {
            return [
                personalNotice(
                    event,
                    context,
                    op === "add" ? "saved_snippet_created" : "saved_snippet_updated",
                    "saved_snippet",
                    "id",
                    op,
                    event.saved_snippet,
                ),
            ];
        }
    }
    const id = numeric(event.saved_snippet_id);
    if (op === "remove" && id !== undefined) {
        return [
            personalNotice(event, context, "saved_snippet_removed", "saved_snippet", "id", op, {
                id,
            }),
        ];
    }
    return [customNotice(event, context)];
}

function projectScheduledMessages(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] {
    const op = stringValue(event.op);
    if (op === "add") {
        const events = resources(event.scheduled_messages, "scheduled_message_id").map(message =>
            personalNotice(
                event,
                context,
                "scheduled_message_created",
                "scheduled_message",
                "scheduled_message_id",
                op,
                message,
            ),
        );
        return events.length ? events : [customNotice(event, context)];
    }
    if (op === "update" && isRecord(event.scheduled_message)) {
        if (numeric(event.scheduled_message.scheduled_message_id) !== undefined) {
            return [
                personalNotice(
                    event,
                    context,
                    "scheduled_message_updated",
                    "scheduled_message",
                    "scheduled_message_id",
                    op,
                    event.scheduled_message,
                ),
            ];
        }
    }
    const id = numeric(event.scheduled_message_id);
    if (op === "remove" && id !== undefined) {
        return [
            personalNotice(
                event,
                context,
                "scheduled_message_removed",
                "scheduled_message",
                "scheduled_message_id",
                op,
                { scheduled_message_id: id },
            ),
        ];
    }
    return [customNotice(event, context)];
}

function projectReminders(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] {
    const op = stringValue(event.op);
    if (op === "add") {
        const events = resources(event.reminders, "reminder_id").map(reminder =>
            personalNotice(
                event,
                context,
                "reminder_created",
                "reminder",
                "reminder_id",
                op,
                reminder,
            ),
        );
        return events.length ? events : [customNotice(event, context)];
    }
    const id = numeric(event.reminder_id);
    if (op === "remove" && id !== undefined) {
        return [
            personalNotice(event, context, "reminder_removed", "reminder", "reminder_id", op, {
                reminder_id: id,
            }),
        ];
    }
    return [customNotice(event, context)];
}

function resources(value: unknown, idField: string): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.filter(item => isRecord(item) && numeric(item[idField]) !== undefined);
}

function personalNotice(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
    noticeType: CommonEvent.NoticeType,
    resourceType: CommonTypes.ResourceType,
    idField: string,
    op: string,
    data: Record<string, unknown>,
): CommonEvent.Notice<ZulipEvent> {
    const id = numeric(data[idField]) ?? 0;
    return {
        ...base(event, context),
        id: context.createId(`event:${event.id}:${id}`),
        type: "notice",
        notice_type: noticeType,
        sub_type: op,
        resource: { ...data, type: resourceType, id: context.createId(id) },
        extensions: { zulip: event },
    };
}
