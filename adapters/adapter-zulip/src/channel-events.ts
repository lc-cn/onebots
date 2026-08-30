import { CommonEvent, type CommonTypes } from "onebots";
import {
    base,
    customNotice,
    isRecord,
    numeric,
    numericArray,
    stringValue,
    type ZulipProjectionContext,
} from "./event-base.js";
import type { ZulipBaseEvent, ZulipEvent } from "./types.js";

/** 投影 Zulip 频道生命周期与订阅关系事件；非本领域事件返回 undefined。 */
export function projectZulipChannelEvents(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] | undefined {
    if (event.type === "stream") return projectStreamEvent(event, context);
    if (event.type === "subscription") return projectSubscriptionEvent(event, context);
    return undefined;
}

function projectStreamEvent(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] {
    const op = stringValue(event.op);
    if (op === "create") {
        const events = channelRecords(event.streams).map(channel =>
            channelNotice(event, context, "channel_created", op, channel),
        );
        return events.length ? events : [customNotice(event, context)];
    }
    if (op === "delete") {
        const events = numericArray(event.stream_ids).map(streamId =>
            channelNotice(event, context, "channel_deleted", op, { stream_id: streamId }),
        );
        return events.length ? events : [customNotice(event, context)];
    }
    const streamId = numeric(event.stream_id);
    const property = stringValue(event.property);
    if (op !== "update" || streamId === undefined || !property) {
        return [customNotice(event, context)];
    }
    return [
        channelNotice(event, context, "channel_updated", op, {
            stream_id: streamId,
            name: stringValue(event.name),
            changed_property: property,
            [property]: event.value,
            ...(stringValue(event.rendered_description) === undefined
                ? {}
                : { rendered_description: event.rendered_description }),
            ...(typeof event.history_public_to_subscribers !== "boolean"
                ? {}
                : { history_public_to_subscribers: event.history_public_to_subscribers }),
            ...(typeof event.is_web_public !== "boolean"
                ? {}
                : { is_web_public: event.is_web_public }),
        }),
    ];
}

function projectSubscriptionEvent(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] {
    const op = stringValue(event.op);
    if (op === "add" || op === "remove") {
        const noticeType =
            op === "add" ? "channel_subscription_added" : "channel_subscription_removed";
        const events = channelRecords(event.subscriptions).map(channel =>
            channelNotice(event, context, noticeType, op, channel),
        );
        return events.length ? events : [customNotice(event, context)];
    }
    const streamId = numeric(event.stream_id);
    const property = stringValue(event.property);
    if (op === "update" && streamId !== undefined && property) {
        return [
            channelNotice(event, context, "channel_subscription_updated", op, {
                stream_id: streamId,
                changed_property: property,
                [property]: event.value,
            }),
        ];
    }
    if (op === "peer_add" || op === "peer_remove") {
        const noticeType =
            op === "peer_add" ? "channel_subscriber_added" : "channel_subscriber_removed";
        const events = numericArray(event.stream_ids).flatMap(streamId =>
            numericArray(event.user_ids).map(userId => ({
                ...channelNotice(event, context, noticeType, op, { stream_id: streamId }, userId),
                user: { id: context.createId(userId) },
            })),
        );
        return events.length ? events : [customNotice(event, context)];
    }
    return [customNotice(event, context)];
}

function channelRecords(value: unknown): Array<Record<string, unknown> & { stream_id: number }> {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (item): item is Record<string, unknown> & { stream_id: number } =>
            isRecord(item) && numeric(item.stream_id) !== undefined,
    );
}

function channelNotice(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
    noticeType: CommonEvent.NoticeType,
    op: string,
    channel: Record<string, unknown> & { stream_id: number },
    userId?: number,
): CommonEvent.Notice<ZulipEvent> {
    const resource: CommonTypes.Resource = {
        ...channel,
        type: "channel",
        id: context.createId(channel.stream_id),
        name: stringValue(channel.name),
    };
    return {
        ...base(event, context),
        id: context.createId(
            `event:${event.id}:${channel.stream_id}${userId === undefined ? "" : `:${userId}`}`,
        ),
        type: "notice",
        notice_type: noticeType,
        sub_type: op,
        resource,
        extensions: { zulip: event },
    };
}
