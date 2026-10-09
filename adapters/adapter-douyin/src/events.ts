import type {
    AnyNoticeEvent,
    GroupMessageEvent,
    GroupJoinRequest,
    MessageEvent,
    PrivateMessageEvent,
    StrangerMessageEvent,
} from "douyin-im";
import type { CommonEvent, CommonTypes } from "onebots";
import { projectDouyinSegments } from "./messages.js";

export interface DouyinProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

export function projectDouyinMessage(
    event: MessageEvent,
    context: DouyinProjectionContext,
): CommonEvent.Message<MessageEvent> {
    const groupEvent = event.isGroup ? (event as GroupMessageEvent) : undefined;
    const group = groupEvent
        ? { id: context.createId(event.threadId), name: groupEvent.group.name ?? "" }
        : undefined;
    const senderName = groupEvent
        ? groupEvent.member.displayName
        : event.chatType === "private"
          ? ((event as PrivateMessageEvent).friend.nickname ?? event.senderUid)
          : ((event as StrangerMessageEvent).stranger.nickname ?? event.senderUid);
    const eventId =
        event.serverMessageId ?? event.clientMessageId ?? `${event.threadId}:${event.time}`;
    return {
        id: context.createId(eventId),
        timestamp: event.time * 1000,
        type: "message",
        platform: "douyin",
        bot_id: context.botId,
        raw_event: event,
        message_type: event.isGroup ? "group" : "private",
        scene_id: context.createId(event.isGroup ? event.threadId : event.senderUid),
        sender: { id: context.createId(event.senderUid), name: senderName },
        ...(group ? { group } : {}),
        message: projectDouyinSegments(event, context.createId),
        raw_message: event.text,
        message_id: context.createId(eventId),
        extensions: {
            douyin: {
                thread_id: event.threadId,
                conversation_short_id: event.conversationShortId,
                message_type: event.messageType,
            },
        },
    };
}

export function projectDouyinGroupRequest(
    event: GroupJoinRequest,
    context: DouyinProjectionContext,
): CommonEvent.Request<GroupJoinRequest> {
    return {
        id: context.createId(`request:${event.requestId}`),
        timestamp: event.time * 1000,
        type: "request",
        platform: "douyin",
        bot_id: context.botId,
        raw_event: event,
        request_type: "group",
        sub_type: "add",
        user: {
            id: context.createId(event.applicantUid),
            name: event.displayName,
            avatar: event.applicantAvatar,
        },
        group: { id: context.createId(event.group.groupId), name: event.group.name ?? "" },
        comment: event.reason,
        flag: event.requestId,
    };
}

export function projectDouyinNotice(
    event: AnyNoticeEvent,
    context: DouyinProjectionContext,
): CommonEvent.Notice<AnyNoticeEvent> | undefined {
    const base = {
        id: context.createId(`notice:${event.type}:${event.time}:${noticeIdentity(event)}`),
        timestamp: event.time * 1000,
        type: "notice" as const,
        platform: "douyin",
        bot_id: context.botId,
        raw_event: event,
    };
    switch (event.type) {
        case "friend.increase":
        case "friend.decrease":
            return {
                ...base,
                notice_type: event.type === "friend.increase" ? "friend_add" : "friend_remove",
                user: { id: context.createId(event.peerUid) },
            };
        case "group.member-increase":
        case "group.invite":
        case "group.member-decrease":
            return {
                ...base,
                notice_type:
                    event.type === "group.member-decrease" ? "member_left" : "member_joined",
                user: { id: context.createId(event.member.uid), name: event.member.displayName },
                operator: event.operator
                    ? { id: context.createId(event.operator.uid), name: event.operator.displayName }
                    : undefined,
                group: { id: context.createId(event.group.groupId), name: event.group.name ?? "" },
            };
        case "group.admin":
            return {
                ...base,
                notice_type: "group_admin",
                user: { id: context.createId(event.member.uid), name: event.member.displayName },
                group: { id: context.createId(event.group.groupId), name: event.group.name ?? "" },
                enabled: event.enabled,
            };
        case "group.name-change":
        case "group.avatar-change":
            return {
                ...base,
                notice_type: "custom",
                group: { id: context.createId(event.group.groupId), name: event.group.name ?? "" },
                extensions: { douyin: { kind: event.type } },
            };
        case "message.recall":
        case "message.delete":
            return {
                ...base,
                notice_type: "message_deleted",
                message_id: event.serverMessageId
                    ? context.createId(event.serverMessageId)
                    : undefined,
            };
        case "message.update":
            return {
                ...base,
                notice_type: "message_updated",
                message_id: event.serverMessageId
                    ? context.createId(event.serverMessageId)
                    : undefined,
            };
        case "message.reaction":
            return {
                ...base,
                notice_type: event.enabled ? "reaction_added" : "reaction_removed",
                message_id: event.serverMessageId
                    ? context.createId(event.serverMessageId)
                    : undefined,
                operator: { id: context.createId(event.operatorUid) },
                reaction: event.emoji,
            };
        default:
            return undefined;
    }
}

function noticeIdentity(event: AnyNoticeEvent): string {
    if ("serverMessageId" in event && event.serverMessageId) return event.serverMessageId;
    if ("conversationId" in event) return event.conversationId;
    if ("peerUid" in event) return event.peerUid;
    return "event";
}
