import type { CommonEvent } from "onebots";
import type { Milky } from "./types.js";

const projectMessage = (event: CommonEvent.Message): Milky.MessageEvent => {
    const isGroup = event.message_type === "group" && event.group !== undefined;
    const sender = event.sender.id.number;
    const peer = isGroup ? event.group!.id.number : sender;
    return {
        time: Math.floor(event.timestamp / 1000),
        self_id: event.bot_id.number,
        event_type: "message_receive",
        data: {
            message_scene: isGroup ? "group" : "friend",
            peer_id: peer,
            message_seq: event.message_id.number,
            sender_id: sender,
            time: Math.floor(event.timestamp / 1000),
            segments: event.message.map(segment => ({
                type: segment.type as Milky.SegmentType,
                data: segment.data,
            })),
            ...(isGroup
                ? {
                      group: {
                          group_id: peer,
                          group_name: event.group?.name,
                      },
                      group_member: {
                          user_id: sender,
                          nickname: event.sender.name,
                      },
                  }
                : {
                      friend: {
                          user_id: sender,
                          nickname: event.sender.name,
                      },
                  }),
        },
    };
};

const projectNotice = (event: CommonEvent.Notice): Milky.NoticeEvent => {
    const eventTypes: Partial<Record<CommonEvent.NoticeType, string>> = {
        group_increase: "group_member_increase",
        group_decrease: "group_member_decrease",
        group_admin: "group_admin_change",
        group_ban: "group_member_mute",
        friend_add: "friend_increase",
    };
    return {
        time: Math.floor(event.timestamp / 1000),
        self_id: event.bot_id.number,
        event_type: eventTypes[event.notice_type] ?? "custom_notice",
        data: {
            ...(event.user ? { user_id: event.user.id.number } : {}),
            ...(event.group ? { group_id: event.group.id.number } : {}),
            ...(event.operator ? { operator_id: event.operator.id.number } : {}),
        },
    };
};

const projectRequest = (event: CommonEvent.Request): Milky.RequestEvent => {
    const subType = (event as CommonEvent.Request & { sub_type?: string }).sub_type;
    const isGroup = event.request_type === "group";
    return {
        time: Math.floor(event.timestamp / 1000),
        self_id: event.bot_id.number,
        event_type: isGroup
            ? subType === "invite"
                ? "group_invited_join_request"
                : "group_join_request"
            : "friend_request",
        data: isGroup
            ? {
                  group_id: event.group?.id.number,
                  initiator_id: event.user.id.number,
                  notification_seq: event.id.number,
                  comment: event.comment ?? "",
                  is_filtered: false,
              }
            : {
                  initiator_id: event.user.id.number,
                  initiator_uid: event.flag,
                  comment: event.comment ?? "",
                  is_filtered: false,
              },
    };
};

const projectMeta = (event: CommonEvent.Meta): Milky.MetaEvent | null => {
    if (event.meta_type !== "lifecycle" || event.sub_type !== "disable") return null;
    return {
        time: Math.floor(event.timestamp / 1000),
        self_id: event.bot_id.number,
        event_type: "bot_offline",
        data: { reason: "adapter offline" },
    };
};

/** 将 CommonEvent 投影为原生 Milky 事件；不可表示的事件返回 null。 */
export const projectMilkyEvent = (event: CommonEvent.Event): Milky.Event | null => {
    switch (event.type) {
        case "message":
            return projectMessage(event);
        case "notice":
            return projectNotice(event);
        case "request":
            return projectRequest(event);
        case "meta":
            return projectMeta(event);
        default:
            return null;
    }
};
