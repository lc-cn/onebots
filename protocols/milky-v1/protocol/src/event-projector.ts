import type { CommonEvent } from "onebots";
import type { Milky } from "./types.js";
import { projectMilkySegments } from "./message-segments.js";
import { projectMilkyNotice } from "./notice-projector.js";

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
            segments: projectMilkySegments(event.message),
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

const projectRequest = (event: CommonEvent.Request): Milky.RequestEvent => {
    const isGroup = event.request_type === "group";
    return {
        time: Math.floor(event.timestamp / 1000),
        self_id: event.bot_id.number,
        event_type: isGroup
            ? event.sub_type === "invite"
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
            return projectMilkyNotice(event);
        case "request":
            return projectRequest(event);
        case "meta":
            return projectMeta(event);
        default:
            return null;
    }
};
