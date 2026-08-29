import { unixSecondsToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import { projectICQQMessageSegments } from "./messages.js";
import type {
    ICQQFriendRecallEvent,
    ICQQFriendRequestEvent,
    ICQQGroupAdminEvent,
    ICQQGroupDecreaseEvent,
    ICQQGroupIncreaseEvent,
    ICQQGroupMessageEvent,
    ICQQGroupMuteEvent,
    ICQQGroupRecallEvent,
    ICQQGroupReactionEvent,
    ICQQGroupRequestEvent,
    ICQQPokeEvent,
    ICQQPrivateMessageEvent,
} from "./types.js";

export interface ICQQProjectionContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}

export function projectICQQMessage(
    event: ICQQPrivateMessageEvent | ICQQGroupMessageEvent,
    context: ICQQProjectionContext,
): CommonEvent.Message {
    const isGroup = "group_id" in event;
    return {
        id: context.createId(event.message_id),
        timestamp: unixSecondsToEventMs(event.time),
        platform: "icqq",
        bot_id: context.botId,
        type: "message",
        message_type: isGroup ? "group" : "private",
        sender: {
            id: context.createId(event.user_id),
            name: event.sender.nickname,
            avatar: `https://q1.qlogo.cn/g?b=qq&nk=${event.user_id}&s=640`,
        },
        group: isGroup
            ? { id: context.createId(event.group_id), name: event.group.group_name }
            : undefined,
        message_id: context.createId(event.message_id),
        raw_message: event.raw_message,
        message: projectICQQMessageSegments(event.message),
        raw_event: event.raw_event,
        extensions: isGroup ? { icqq: { at_me: event.atme, sender: event.sender } } : undefined,
    };
}

export function projectICQQRequest(
    event: ICQQFriendRequestEvent | ICQQGroupRequestEvent,
    context: ICQQProjectionContext,
): CommonEvent.Request {
    const isGroup = "group_id" in event;
    return {
        id: context.createId(event.request_id),
        timestamp: unixSecondsToEventMs(event.time),
        platform: "icqq",
        bot_id: context.botId,
        type: "request",
        request_type: isGroup ? "group" : "friend",
        sub_type: isGroup ? event.sub_type : undefined,
        user: { id: context.createId(event.user_id), name: event.nickname },
        group: isGroup ? { id: context.createId(event.group_id) } : undefined,
        comment: event.comment,
        flag: event.request_id,
        raw_event: event.raw_event,
    };
}

export function projectICQQMembership(
    event: ICQQGroupIncreaseEvent | ICQQGroupDecreaseEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    const increase = !("sub_type" in event);
    return noticeBase(
        event,
        context,
        increase ? "group_increase" : "group_decrease",
        increase ? (event.operator_id === event.user_id ? "approve" : "invite") : event.sub_type,
        {
            user: { id: context.createId(event.user_id) },
            operator: event.operator_id ? { id: context.createId(event.operator_id) } : undefined,
            extensions:
                "is_dismiss" in event ? { icqq: { is_dismiss: event.is_dismiss } } : undefined,
        },
    );
}

export function projectICQQMute(
    event: ICQQGroupMuteEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    const all = event.user_id === 0;
    return noticeBase(
        event,
        context,
        "group_ban",
        `${all ? "all_" : ""}${event.duration ? "ban" : "lift"}`,
        {
            user: all ? undefined : { id: context.createId(event.user_id) },
            operator: { id: context.createId(event.operator_id) },
            duration: event.duration,
        },
    );
}

export function projectICQQAdmin(
    event: ICQQGroupAdminEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return noticeBase(event, context, "group_admin", event.sub_type, {
        user: { id: context.createId(event.user_id) },
    });
}

export function projectICQQRecall(
    event: ICQQFriendRecallEvent | ICQQGroupRecallEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    const group = "group_id" in event;
    return noticeBase(event, context, "message_deleted", group ? "group" : "private", {
        message_id: context.createId(event.message_id),
        user: { id: context.createId(event.user_id) },
        operator: group ? { id: context.createId(event.operator_id) } : undefined,
        group: group ? { id: context.createId(event.group_id) } : undefined,
    });
}

export function projectICQQReaction(
    event: ICQQGroupReactionEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return noticeBase(
        event,
        context,
        event.is_add ? "reaction_added" : "reaction_removed",
        event.reaction_type,
        {
            user: { id: context.createId(event.user_id) },
            message_id: context.createId(event.message_seq),
            face_id: event.face_id,
            reaction_type: event.reaction_type,
            is_add: event.is_add,
        },
    );
}

export function projectICQQPoke(
    event: ICQQPokeEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return noticeBase(event, context, "interaction", "poke", {
        user: { id: context.createId(event.target_id) },
        operator: { id: context.createId(event.operator_id) },
        group: event.group_id ? { id: context.createId(event.group_id) } : undefined,
        action: event.action,
        suffix: event.suffix,
    });
}

function noticeBase(
    event: { time: number; group_id?: number; raw_event: unknown },
    context: ICQQProjectionContext,
    noticeType: CommonEvent.NoticeType,
    subType: string,
    fields: Partial<CommonEvent.Notice>,
): CommonEvent.Notice {
    const identity = [fields.message_id?.string, fields.user?.id.string, fields.operator?.id.string]
        .filter((value): value is string => Boolean(value))
        .join(":");
    const eventKey = `${noticeType}:${event.group_id ?? "private"}:${event.time}:${subType}:${identity}`;
    return {
        id: context.createId(eventKey),
        timestamp: unixSecondsToEventMs(event.time),
        platform: "icqq",
        bot_id: context.botId,
        type: "notice",
        notice_type: noticeType,
        sub_type: subType,
        group: event.group_id ? { id: context.createId(event.group_id) } : undefined,
        raw_event: event.raw_event,
        ...fields,
    };
}
