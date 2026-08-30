import { CommonEvent } from "onebots";
import {
    base,
    customNotice,
    isRecord,
    numeric,
    stringValue,
    type ZulipProjectionContext,
} from "./event-base.js";
import type { ZulipBaseEvent, ZulipEvent } from "./types.js";

/** 投影在线状态、输入状态与个人话题偏好事件。 */
export function projectZulipActivityEvents(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] | undefined {
    if (event.type === "presence") return projectPresence(event, context);
    if (event.type === "user_topic") return [projectUserTopic(event, context)];
    if (event.type === "typing") return [projectTyping(event, context)];
    return undefined;
}

function projectPresence(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] {
    if (isRecord(event.presences)) {
        const events = Object.entries(event.presences).flatMap(([userId, presence]) => {
            const id = numeric(Number(userId));
            return id === undefined || !isRecord(presence)
                ? []
                : [presenceNotice(event, context, id, presence)];
        });
        if (events.length) return events;
    }
    const userId = numeric(event.user_id);
    if (userId !== undefined && isRecord(event.presence)) {
        return [presenceNotice(event, context, userId, event.presence)];
    }
    return [customNotice(event, context)];
}

function presenceNotice(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
    userId: number,
    presence: Record<string, unknown>,
): CommonEvent.Notice<ZulipEvent> {
    const serverTimestamp = typeof event.server_timestamp === "number" ? event.server_timestamp : 0;
    return {
        ...base(event, context, serverTimestamp * 1000),
        id: context.createId(`event:${event.id}:${userId}`),
        type: "notice",
        notice_type: "user_updated",
        sub_type: "presence_online",
        user: { id: context.createId(userId), presence },
        extensions: { zulip: event },
    };
}

function projectUserTopic(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const streamId = numeric(event.stream_id);
    const topic = stringValue(event.topic_name);
    const policy = numeric(event.visibility_policy);
    if (streamId === undefined || topic === undefined || policy === undefined || policy > 3) {
        return customNotice(event, context);
    }
    return {
        ...base(event, context, (numeric(event.last_updated) ?? 0) * 1000),
        type: "notice",
        notice_type: "topic_visibility_updated",
        sub_type: ["none", "muted", "unmuted", "followed"][policy] || "unknown",
        resource: {
            type: "topic",
            id: context.createId(`${streamId}/${topic}`),
            name: topic,
            stream_id: streamId,
            visibility_policy: policy,
        },
        extensions: { zulip: event },
    };
}

function projectTyping(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const op = stringValue(event.op);
    const messageType = stringValue(event.message_type);
    const sender = isRecord(event.sender) ? event.sender : undefined;
    const userId = numeric(sender?.user_id);
    if (
        (op !== "start" && op !== "stop") ||
        (messageType !== "direct" && messageType !== "stream") ||
        userId === undefined
    ) {
        return customNotice(event, context);
    }
    const streamId = numeric(event.stream_id);
    const topic = stringValue(event.topic);
    if (messageType === "stream" && (streamId === undefined || topic === undefined)) {
        return customNotice(event, context);
    }
    return {
        ...base(event, context),
        type: "notice",
        notice_type: op === "start" ? "typing_started" : "typing_stopped",
        sub_type: messageType,
        user: { id: context.createId(userId), email: stringValue(sender?.email) },
        group:
            messageType === "direct"
                ? undefined
                : { id: context.createId(`${streamId}/${topic || ""}`), name: topic },
        extensions: { zulip: event },
    };
}
