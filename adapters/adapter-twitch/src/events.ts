import type { CommonEvent, CommonTypes } from "onebots";
import { projectTwitchFragments } from "./messages.js";
import type { TwitchDelivery, TwitchEventSubMessage } from "./types.js";
import { isRecord } from "./validation.js";

export interface TwitchProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

/** 将全部 EventSub envelope 投影到 canonical 事件；未专门映射的类型无损降为 custom。 */
export function projectTwitchEvent(
    delivery: TwitchDelivery,
    context: TwitchProjectionContext,
): CommonEvent.Event<TwitchEventSubMessage>[] {
    const { envelope, event } = delivery;
    if (envelope.metadata.message_type === "session_keepalive") {
        return [{ ...base(delivery, context), type: "meta", meta_type: "heartbeat" }];
    }
    if (envelope.metadata.message_type === "revocation") {
        return [customNotice(delivery, context, "eventsub_revocation")];
    }
    const subscriptionType =
        delivery.subscription?.type || envelope.metadata.subscription_type || "unknown";
    if (subscriptionType === "channel.chat.message" && event) {
        return [channelMessage(delivery, context)];
    }
    if (subscriptionType === "whisper.received" && event) {
        return [whisperMessage(delivery, context)];
    }
    if (subscriptionType === "channel.chat.message_delete") {
        return [notice(delivery, context, "message_deleted")];
    }
    if (
        subscriptionType === "channel.update" ||
        subscriptionType === "channel.chat_settings.update"
    ) {
        return [notice(delivery, context, "channel_updated", channelResource(event, context))];
    }
    if (subscriptionType === "channel.follow") {
        return [notice(delivery, context, "channel_subscriber_added")];
    }
    if (subscriptionType === "channel.subscribe") {
        return [notice(delivery, context, "channel_subscription_added")];
    }
    if (subscriptionType === "channel.subscription.end") {
        return [notice(delivery, context, "channel_subscription_removed")];
    }
    if (
        subscriptionType === "channel.subscription.message" ||
        subscriptionType === "channel.subscription.gift"
    ) {
        return [notice(delivery, context, "channel_subscription_updated")];
    }
    if (subscriptionType === "channel.ban" || subscriptionType === "channel.unban") {
        return [notice(delivery, context, "group_ban")];
    }
    if (subscriptionType === "channel.chat.clear_user_messages") {
        return [notice(delivery, context, "message_deleted")];
    }
    return [customNotice(delivery, context, subscriptionType)];
}

function channelMessage(
    delivery: TwitchDelivery,
    context: TwitchProjectionContext,
): CommonEvent.Message<TwitchEventSubMessage> {
    const event = delivery.event || {};
    const broadcasterId =
        stringField(event.broadcaster_user_id) ||
        delivery.subscription?.condition.broadcaster_user_id ||
        "unknown";
    const message = event.message;
    return {
        ...base(delivery, context),
        type: "message",
        message_type: "channel",
        sender: user(event, context, "chatter"),
        group: {
            id: context.createId(broadcasterId),
            channel_id: context.createId(broadcasterId),
            name: stringField(event.broadcaster_user_name),
        },
        message_id: context.createId(
            stringField(event.message_id) || delivery.envelope.metadata.message_id,
        ),
        message: projectTwitchFragments(message),
        raw_message: isRecord(message) ? stringField(message.text) : undefined,
        extensions: { twitch: eventExtensions(delivery) },
    };
}

function whisperMessage(
    delivery: TwitchDelivery,
    context: TwitchProjectionContext,
): CommonEvent.Message<TwitchEventSubMessage> {
    const event = delivery.event || {};
    const whisper = isRecord(event.whisper) ? event.whisper : {};
    const text = stringField(whisper.text) || "";
    return {
        ...base(delivery, context),
        type: "message",
        message_type: "direct",
        sender: user(event, context, "from"),
        message_id: context.createId(
            stringField(whisper.message_id) || delivery.envelope.metadata.message_id,
        ),
        message: [{ type: "text", data: { text } }],
        raw_message: text,
        extensions: { twitch: eventExtensions(delivery) },
    };
}

function notice(
    delivery: TwitchDelivery,
    context: TwitchProjectionContext,
    noticeType: CommonEvent.Notice["notice_type"],
    resource?: CommonTypes.Resource,
): CommonEvent.Notice<TwitchEventSubMessage> {
    const event = delivery.event || {};
    const messageId = stringField(event.message_id);
    return {
        ...base(delivery, context),
        type: "notice",
        notice_type: noticeType,
        sub_type: delivery.subscription?.type,
        user: eventUser(event, context),
        operator: operatorUser(event, context),
        group: channelGroup(event, delivery, context),
        message_id: messageId ? context.createId(messageId) : undefined,
        resource,
        extensions: { twitch: eventExtensions(delivery) },
    };
}

function customNotice(
    delivery: TwitchDelivery,
    context: TwitchProjectionContext,
    subType: string,
): CommonEvent.Notice<TwitchEventSubMessage> {
    return {
        ...base(delivery, context),
        type: "notice",
        notice_type: "custom",
        sub_type: subType,
        user: eventUser(delivery.event || {}, context),
        group: channelGroup(delivery.event || {}, delivery, context),
        extensions: { twitch: eventExtensions(delivery) },
    };
}

function base(
    delivery: TwitchDelivery,
    context: TwitchProjectionContext,
): CommonEvent.Base<TwitchEventSubMessage> {
    const eventId =
        delivery.batchIndex === undefined
            ? delivery.envelope.metadata.message_id
            : `${delivery.envelope.metadata.message_id}:${delivery.batchIndex}`;
    return {
        id: context.createId(eventId),
        timestamp: Date.parse(delivery.envelope.metadata.message_timestamp),
        type: delivery.subscription?.type || delivery.envelope.metadata.message_type,
        platform: "twitch",
        bot_id: context.botId,
        raw_event: delivery.envelope,
    };
}

function channelGroup(
    event: Record<string, unknown>,
    delivery: TwitchDelivery,
    context: TwitchProjectionContext,
): CommonTypes.Group | undefined {
    const id =
        stringField(event.broadcaster_user_id) ||
        delivery.subscription?.condition.broadcaster_user_id;
    return id
        ? {
              id: context.createId(id),
              channel_id: context.createId(id),
              name: stringField(event.broadcaster_user_name),
          }
        : undefined;
}

function eventUser(
    event: Record<string, unknown>,
    context: TwitchProjectionContext,
): CommonTypes.User | undefined {
    for (const prefix of ["user", "chatter", "target_user", "from_user"]) {
        const id = stringField(event[`${prefix}_id`]);
        if (id) return user(event, context, prefix);
    }
    return undefined;
}

function operatorUser(
    event: Record<string, unknown>,
    context: TwitchProjectionContext,
): CommonTypes.User | undefined {
    for (const prefix of ["moderator", "broadcaster"]) {
        const id = stringField(event[`${prefix}_user_id`]);
        if (id) return user(event, context, prefix);
    }
    return undefined;
}

function user(
    event: Record<string, unknown>,
    context: TwitchProjectionContext,
    prefix: string,
): CommonTypes.User {
    const id =
        stringField(event[`${prefix}_user_id`]) || stringField(event[`${prefix}_id`]) || "unknown";
    return {
        id: context.createId(id),
        name: stringField(event[`${prefix}_user_name`]) || stringField(event[`${prefix}_name`]),
        login: stringField(event[`${prefix}_user_login`]) || stringField(event[`${prefix}_login`]),
    };
}

function channelResource(
    event: Record<string, unknown> | undefined,
    context: TwitchProjectionContext,
): CommonTypes.Resource | undefined {
    if (!event) return undefined;
    const id = stringField(event.broadcaster_user_id);
    return id
        ? {
              type: "channel",
              id: context.createId(id),
              name: stringField(event.broadcaster_user_name),
          }
        : undefined;
}

function eventExtensions(delivery: TwitchDelivery): Record<string, unknown> {
    return {
        subscription: delivery.subscription,
        event: delivery.event,
        batch_index: delivery.batchIndex,
        message_type: delivery.envelope.metadata.message_type,
    };
}

function stringField(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
