import { unixSecondsToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import { projectICQQMessageSegments } from "./messages.js";
import type {
    ICQQDiscussMessageEvent,
    ICQQFriendChangeEvent,
    ICQQGroupSignEvent,
    ICQQGroupTransferEvent,
    ICQQGuildMessageEvent,
    ICQQReadSyncEvent,
    ICQQTypingEvent,
} from "./extended-event-types.js";
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
        extensions: {
            icqq: isGroup
                ? {
                      sub_type: event.sub_type,
                      at_me: event.atme,
                      at_all: event.atall,
                      anonymous: event.anonymous,
                      block: event.block,
                      sender: event.sender,
                  }
                : {
                      sub_type: event.sub_type,
                      from_uid: event.from_uid,
                      to_id: event.to_id,
                      to_uid: event.to_uid,
                      auto_reply: event.auto_reply,
                      sender: event.sender,
                  },
        },
    };
}

export function projectICQQSyncedMessage(
    event: ICQQPrivateMessageEvent,
    context: ICQQProjectionContext,
): CommonEvent.Message {
    const projected = projectICQQMessage(event, context);
    return {
        ...projected,
        extensions: { icqq: { synced: true } },
    };
}

export function projectICQQDiscussMessage(
    event: ICQQDiscussMessageEvent,
    context: ICQQProjectionContext,
): CommonEvent.Message {
    const sceneId = `discuss:${event.discuss_id}`;
    return {
        ...messageBase(event, context),
        type: "message",
        message_type: "group",
        sender: { id: context.createId(event.user_id), name: event.sender.nickname },
        group: { id: context.createId(sceneId), name: event.discuss_name },
        message_id: context.createId(event.message_id),
        raw_message: event.raw_message,
        message: projectICQQMessageSegments(event.message),
        extensions: {
            icqq: { scene_type: "discuss", discuss_id: event.discuss_id, at_me: event.atme },
        },
    };
}

export function projectICQQGuildMessage(
    event: ICQQGuildMessageEvent,
    context: ICQQProjectionContext,
): CommonEvent.Message | CommonEvent.Notice {
    if (event.is_delete) {
        return {
            ...messageBase(event, context),
            type: "notice",
            notice_type: "message_deleted",
            sub_type: "channel",
            message_id: context.createId(event.message_id),
            user: { id: context.createId(event.user_id), name: event.sender.nickname },
            group: channelGroup(event, context),
        };
    }
    return {
        ...messageBase(event, context),
        type: "message",
        message_type: "channel",
        sender: { id: context.createId(event.user_id), name: event.sender.nickname },
        group: channelGroup(event, context),
        message_id: context.createId(event.message_id),
        raw_message: event.raw_message,
        message: projectICQQMessageSegments(event.message),
    };
}

export function projectICQQFriendChange(
    event: ICQQFriendChangeEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return nativeNotice(
        event,
        context,
        event.change_type === "increase" ? "friend_add" : "friend_remove",
        {
            sub_type: event.change_type,
            user: { id: context.createId(event.user_id), name: event.nickname },
        },
    );
}

export function projectICQQGroupSign(
    event: ICQQGroupSignEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return nativeNotice(event, context, "custom", {
        sub_type: "group_sign",
        user: { id: context.createId(event.user_id), name: event.nickname },
        sign_text: event.sign_text,
    });
}

export function projectICQQGroupTransfer(
    event: ICQQGroupTransferEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return nativeNotice(event, context, "custom", {
        sub_type: "group_transfer",
        user: { id: context.createId(event.user_id) },
        operator: { id: context.createId(event.operator_id) },
    });
}

export function projectICQQReadSync(
    event: ICQQReadSyncEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return nativeNotice(event, context, "message_status", {
        sub_type: "read",
        ...(event.scene_type === "group"
            ? { group: { id: context.createId(event.scene_id) } }
            : { user: { id: context.createId(event.scene_id) } }),
        cursor: event.cursor,
        extensions: { icqq: { scene_type: event.scene_type } },
    });
}

export function projectICQQTyping(
    event: ICQQTypingEvent,
    context: ICQQProjectionContext,
): CommonEvent.Notice {
    return nativeNotice(event, context, "interaction", {
        sub_type: "typing",
        user: { id: context.createId(event.user_id) },
        end: event.end,
    });
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
        extensions: {
            icqq: isGroup
                ? {
                      group_name: event.group_name,
                      inviter_id: event.inviter_id,
                      tips: event.tips,
                      role: event.role,
                  }
                : {
                      sub_type: event.sub_type,
                      source: event.source,
                      age: event.age,
                      sex: event.sex,
                  },
        },
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
            user: {
                id: context.createId(event.user_id),
                ...("nickname" in event ? { name: event.nickname } : {}),
            },
            operator: event.operator_id ? { id: context.createId(event.operator_id) } : undefined,
            extensions:
                "is_dismiss" in event
                    ? { icqq: { is_dismiss: event.is_dismiss, member: event.member } }
                    : undefined,
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
            extensions:
                event.nickname === undefined ? undefined : { icqq: { nickname: event.nickname } },
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
        extensions: { icqq: { seq: event.seq, rand: event.rand } },
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

function messageBase(
    event: { raw_event: unknown; message_id: string; time: number },
    context: ICQQProjectionContext,
): Pick<CommonEvent.Message, "id" | "timestamp" | "platform" | "bot_id" | "raw_event"> {
    return {
        id: context.createId(event.message_id),
        timestamp: unixSecondsToEventMs(event.time),
        platform: "icqq",
        bot_id: context.botId,
        raw_event: event.raw_event,
    };
}

function channelGroup(
    event: ICQQGuildMessageEvent,
    context: ICQQProjectionContext,
): CommonTypes.Group {
    return {
        id: context.createId(event.channel_id),
        name: event.channel_name,
        guild_id: context.createId(event.guild_id),
        channel_id: context.createId(event.channel_id),
    };
}

function nativeNotice(
    event: { raw_event: unknown; time: number; group_id?: number },
    context: ICQQProjectionContext,
    noticeType: CommonEvent.NoticeType,
    fields: Partial<CommonEvent.Notice>,
): CommonEvent.Notice {
    const subType = typeof fields.sub_type === "string" ? fields.sub_type : noticeType;
    return noticeBase(event, context, noticeType, subType, fields);
}
