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
import { projectZulipChannelEvents } from "./channel-events.js";
import { projectZulipResourceEvent } from "./resource-events.js";
import { projectZulipScheduledMessageEvents } from "./scheduled-message-events.js";
import type {
    ZulipBaseEvent,
    ZulipDeleteMessageEvent,
    ZulipEvent,
    ZulipMessage,
    ZulipMessageEvent,
    ZulipReactionEvent,
    ZulipUpdateMessageEvent,
    ZulipUpdateMessageFlagsEvent,
} from "./types.js";

/** 将官方 Event Queue 事件无损投影为一个或多个通用事件。 */
export function projectZulipEvents(
    event: ZulipEvent,
    context: ZulipProjectionContext,
): CommonEvent.Event<ZulipEvent>[] {
    if (isMessageEvent(event)) return [projectMessage(event, context)];
    if (isUpdateEvent(event)) return [projectUpdate(event, context)];
    if (isDeleteEvent(event)) return [projectDelete(event, context)];
    if (isReactionEvent(event)) return [projectReaction(event, context)];
    if (isMessageFlagsEvent(event)) return [projectMessageFlags(event, context)];
    if (event.type === "heartbeat") {
        return [
            {
                ...base(event, context),
                type: "meta",
                meta_type: "heartbeat",
                sub_type: "event_queue",
            },
        ];
    }
    if (event.type === "realm_user") return [projectRealmUser(event, context)];
    if (event.type === "user_group") return projectUserGroup(event, context);
    if (event.type === "realm_emoji") return [projectRealmEmoji(event, context)];
    const channelEvents = projectZulipChannelEvents(event, context);
    if (channelEvents) return channelEvents;
    const scheduledMessageEvents = projectZulipScheduledMessageEvents(event, context);
    if (scheduledMessageEvents) return scheduledMessageEvents;
    const resourceEvent = projectZulipResourceEvent(event, context);
    if (resourceEvent) return [resourceEvent];
    return [customNotice(event, context)];
}

function projectMessageFlags(
    event: ZulipUpdateMessageFlagsEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const messageIds = event.messages.map(messageId => context.createId(messageId));
    return {
        ...base(event, context),
        type: "notice",
        notice_type: "message_flags_updated",
        sub_type: `${event.op}:${event.flag}`,
        ...(messageIds.length === 1 ? { message_id: messageIds[0] } : {}),
        message_ids: messageIds,
        flag: event.flag,
        operation: event.op,
        all: event.all === true,
        ...(event.message_details === undefined ? {} : { message_details: event.message_details }),
        extensions: { zulip: event },
    };
}

function projectRealmEmoji(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const op = stringValue(event.op);
    const emoji = isRecord(event.emoji) ? event.emoji : undefined;
    const data = isRecord(event.data) ? event.data : undefined;
    const emojiId = stringValue(emoji?.id) || stringValue(event.emoji_id);
    if ((op !== "add" && op !== "update_one") || !emojiId) {
        return customNotice(event, context);
    }
    const deactivated = typeof data?.deactivated === "boolean" ? data.deactivated : undefined;
    return {
        ...base(event, context),
        type: "notice",
        notice_type: op === "add" ? "emoji_created" : "emoji_updated",
        sub_type:
            op === "add"
                ? "added"
                : deactivated === undefined
                  ? "updated"
                  : deactivated
                    ? "deactivated"
                    : "reactivated",
        resource: {
            ...(emoji || {}),
            ...(data || {}),
            type: "emoji",
            id: context.createId(emojiId),
            name: stringValue(emoji?.name),
        },
        extensions: { zulip: event },
    };
}

/** 将 Zulip Markdown 消息及附件投影为通用消息段。 */
export function projectZulipMessage(
    message: ZulipMessage,
    serverUrl?: string,
): CommonTypes.Segment[] {
    const result: CommonTypes.Segment[] = [];
    if (message.content) result.push({ type: "text", data: { text: message.content } });
    for (const attachment of message.attachments || []) {
        result.push({
            type: imageExtension(attachment.name) ? "image" : "file",
            data: {
                file: attachment.path,
                url: resolveMediaUrl(attachment.path, serverUrl),
                name: attachment.name,
                size: attachment.size,
                id: attachment.id,
            },
        });
    }
    return result;
}

function projectMessage(
    event: ZulipMessageEvent,
    context: ZulipProjectionContext,
): CommonEvent.Message<ZulipEvent> {
    const message = event.message;
    const messageType = message.type || message.message_type || "private";
    const isStream = messageType === "stream" || messageType === "channel";
    const directRecipientIds = Array.isArray(message.display_recipient)
        ? message.display_recipient
              .map(recipient => recipient.id)
              .filter(id => id !== context.botUserId)
              .sort((left, right) => left - right)
        : [];
    const topic = message.subject || "";
    const streamId = message.stream_id;
    return {
        ...base(event, context, message.timestamp * 1000),
        type: "message",
        message_type: isStream ? "group" : directRecipientIds.length > 1 ? "direct" : "private",
        sender: {
            id: context.createId(message.sender_id),
            name: message.sender_full_name,
            avatar: message.avatar_url || undefined,
            email: message.sender_email,
        },
        group:
            isStream && streamId !== undefined
                ? {
                      id: context.createId(`${streamId}/${topic}`),
                      name:
                          typeof message.display_recipient === "string"
                              ? message.display_recipient
                              : message.stream_name,
                      stream_id: streamId,
                      topic,
                  }
                : undefined,
        message_id: context.createId(message.id),
        message: projectZulipMessage(message, context.serverUrl),
        raw_message: message.content,
        extensions: {
            zulip: {
                topic,
                stream_id: streamId,
                flags: message.flags || event.flags,
                reactions: message.reactions,
                recipients: message.display_recipient,
                scene_id: isStream
                    ? `${streamId}/${topic}`
                    : directRecipientIds.length
                      ? directRecipientIds.join(",")
                      : String(message.sender_id),
            },
        },
    };
}

function projectUpdate(
    event: ZulipUpdateMessageEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    return {
        ...base(event, context, event.edit_timestamp * 1000),
        type: "notice",
        notice_type: "message_updated",
        message_id: context.createId(event.message_id),
        user: { id: context.createId(event.user_id) },
        group:
            event.stream_id === undefined
                ? undefined
                : {
                      id: context.createId(
                          `${event.stream_id}/${event.topic || event.orig_topic || ""}`,
                      ),
                      name: event.topic || event.orig_topic,
                  },
        message: event.content ? [{ type: "text", data: { text: event.content } }] : undefined,
        extensions: { zulip: event },
    };
}

function projectDelete(
    event: ZulipDeleteMessageEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    return {
        ...base(event, context),
        type: "notice",
        notice_type: "message_deleted",
        message_id: context.createId(event.message_id),
        group:
            event.stream_id === undefined
                ? undefined
                : {
                      id: context.createId(`${event.stream_id}/${event.topic || ""}`),
                      name: event.topic,
                  },
        extensions: { zulip: event },
    };
}

function projectReaction(
    event: ZulipReactionEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    return {
        ...base(event, context),
        type: "notice",
        notice_type: event.op === "add" ? "reaction_added" : "reaction_removed",
        message_id: context.createId(event.message_id),
        user: {
            id: context.createId(event.user_id),
            name: event.user?.full_name,
            email: event.user?.email,
        },
        extensions: {
            zulip: {
                emoji_name: event.emoji_name,
                emoji_code: event.emoji_code,
                reaction_type: event.reaction_type,
            },
        },
    };
}

function projectRealmUser(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent> {
    const op = typeof event.op === "string" ? event.op : "update";
    const person = isRecord(event.person) ? event.person : undefined;
    const userId = numeric(person?.user_id) ?? numeric(event.person_id) ?? 0;
    const isActive = typeof person?.is_active === "boolean" ? person.is_active : undefined;
    const noticeType =
        op === "add" ? "user_added" : op === "remove" ? "user_removed" : "user_updated";
    return {
        ...base(event, context),
        type: "notice",
        notice_type: noticeType,
        sub_type:
            op === "update" && isActive !== undefined
                ? isActive
                    ? "reactivated"
                    : "deactivated"
                : op,
        user: userId
            ? {
                  id: context.createId(userId),
                  name: stringValue(person?.full_name),
                  avatar: stringValue(person?.avatar_url),
                  ...(isActive === undefined ? {} : { is_active: isActive }),
              }
            : undefined,
        extensions: { zulip: event },
    };
}

function projectUserGroup(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
): CommonEvent.Notice<ZulipEvent>[] {
    const op = stringValue(event.op) || "update";
    const group = isRecord(event.group) ? event.group : undefined;
    const data = isRecord(event.data) ? event.data : undefined;
    const groupId = numeric(group?.id) ?? numeric(event.group_id);
    if (groupId === undefined) return [customNotice(event, context)];
    const resource: CommonTypes.Resource = {
        ...(group || {}),
        ...(data || {}),
        type: "user_group",
        id: context.createId(groupId),
        name: stringValue(group?.name) || stringValue(data?.name),
    };
    const memberIds = numericArray(event.user_ids);
    if (op === "add_members" || op === "remove_members") {
        if (!memberIds.length) return [customNotice(event, context)];
        return memberIds.map(userId => ({
            ...noticeBase(event, context, resource, op, userId),
            notice_type:
                op === "add_members" ? "user_group_member_added" : "user_group_member_removed",
            user: { id: context.createId(userId) },
        }));
    }
    const subgroupIds = numericArray(event.direct_subgroup_ids);
    if (op === "add_subgroups" || op === "remove_subgroups") {
        if (!subgroupIds.length) return [customNotice(event, context)];
        return subgroupIds.map(subgroupId => ({
            ...noticeBase(event, context, resource, op, subgroupId),
            notice_type:
                op === "add_subgroups"
                    ? "user_group_subgroup_added"
                    : "user_group_subgroup_removed",
            resource: { ...resource, related_user_group_id: context.createId(subgroupId) },
        }));
    }
    const deactivated = data?.deactivated;
    const noticeType: CommonEvent.NoticeType =
        op === "add"
            ? "user_group_created"
            : op === "remove" || deactivated === true
              ? "user_group_deactivated"
              : deactivated === false
                ? "user_group_reactivated"
                : "user_group_updated";
    const createdAt = numeric(group?.date_created);
    return [
        {
            ...noticeBase(event, context, resource, op),
            timestamp: createdAt === undefined ? 0 : createdAt * 1000,
            notice_type: noticeType,
        },
    ];
}

function noticeBase(
    event: ZulipBaseEvent,
    context: ZulipProjectionContext,
    resource: CommonTypes.Resource,
    op: string,
    relatedId?: number,
): CommonEvent.Notice<ZulipEvent> {
    return {
        ...base(event, context),
        ...(relatedId === undefined
            ? {}
            : { id: context.createId(`event:${event.id}:${relatedId}`) }),
        type: "notice",
        notice_type: "user_group_updated",
        sub_type: op,
        resource,
        extensions: { zulip: event },
    };
}

function isMessageEvent(event: ZulipEvent): event is ZulipMessageEvent {
    return event.type === "message" && isRecord(event.message);
}

function isUpdateEvent(event: ZulipEvent): event is ZulipUpdateMessageEvent {
    return event.type === "update_message" && typeof event.message_id === "number";
}

function isDeleteEvent(event: ZulipEvent): event is ZulipDeleteMessageEvent {
    return event.type === "delete_message" && typeof event.message_id === "number";
}

function isReactionEvent(event: ZulipEvent): event is ZulipReactionEvent {
    return (
        event.type === "reaction" &&
        (event.op === "add" || event.op === "remove") &&
        typeof event.message_id === "number"
    );
}

function isMessageFlagsEvent(event: ZulipEvent): event is ZulipUpdateMessageFlagsEvent {
    return (
        event.type === "update_message_flags" &&
        (event.op === "add" || event.op === "remove") &&
        typeof event.flag === "string" &&
        Array.isArray(event.messages) &&
        event.messages.every(messageId => numeric(messageId) !== undefined)
    );
}

function imageExtension(name: string): boolean {
    return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(name);
}

function resolveMediaUrl(path: string, serverUrl: string | undefined): string {
    if (!serverUrl || /^https?:\/\//i.test(path)) return path;
    return new URL(path, serverUrl).toString();
}
