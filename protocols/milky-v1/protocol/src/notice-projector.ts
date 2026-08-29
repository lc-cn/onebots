import type { CommonEvent } from "onebots";
import type { Milky } from "./types.js";

/** 按 Milky 事件语义投影 notice；不可准确表达的通用 notice 不伪造事件。 */
export function projectMilkyNotice(event: CommonEvent.Notice): Milky.NoticeEvent | null {
    const base = {
        time: Math.floor(event.timestamp / 1000),
        self_id: event.bot_id.number,
    };
    const groupId = event.group?.id.number;
    const userId = event.user?.id.number;
    const operatorId = event.operator?.id.number;

    if (event.notice_type === "group_decrease" && isGroupDisband(event) && groupId && operatorId) {
        return {
            ...base,
            event_type: "group_disband",
            data: { group_id: groupId, operator_id: operatorId },
        };
    }

    switch (event.notice_type) {
        case "group_increase":
            if (!groupId || !userId) return null;
            return {
                ...base,
                event_type: "group_member_increase",
                data: {
                    group_id: groupId,
                    user_id: userId,
                    ...(event.sub_type === "invite"
                        ? operatorId
                            ? { invitor_id: operatorId }
                            : {}
                        : operatorId
                          ? { operator_id: operatorId }
                          : {}),
                },
            };
        case "group_decrease":
            if (!groupId || !userId) return null;
            return {
                ...base,
                event_type: "group_member_decrease",
                data: {
                    group_id: groupId,
                    user_id: userId,
                    ...(operatorId ? { operator_id: operatorId } : {}),
                },
            };
        case "group_admin":
            if (!groupId || !userId) return null;
            return {
                ...base,
                event_type: "group_admin_change",
                data: {
                    group_id: groupId,
                    user_id: userId,
                    ...(operatorId ? { operator_id: operatorId } : {}),
                    is_set: event.sub_type === "set",
                },
            };
        case "group_ban":
            if (!groupId || !operatorId) return null;
            if (!userId) {
                return {
                    ...base,
                    event_type: "group_whole_mute",
                    data: {
                        group_id: groupId,
                        operator_id: operatorId,
                        is_mute: duration(event) > 0,
                    },
                };
            }
            return {
                ...base,
                event_type: "group_mute",
                data: {
                    group_id: groupId,
                    user_id: userId,
                    operator_id: operatorId,
                    duration: duration(event),
                },
            };
        case "message_deleted": {
            if (!event.message_id || !userId) return null;
            const group = Boolean(groupId);
            return {
                ...base,
                event_type: "message_recall",
                data: {
                    message_scene: group ? "group" : "friend",
                    peer_id: groupId ?? userId,
                    message_seq: event.message_id.number,
                    sender_id: userId,
                    operator_id: operatorId ?? userId,
                    display_suffix: "",
                },
            };
        }
        case "reaction_added":
        case "reaction_removed":
            if (!groupId || !userId || !event.message_id) return null;
            return {
                ...base,
                event_type: "group_message_reaction",
                data: {
                    group_id: groupId,
                    user_id: userId,
                    message_seq: event.message_id.number,
                    face_id: typeof event.face_id === "string" ? event.face_id : "",
                    reaction_type: event.reaction_type === "emoji" ? "emoji" : "face",
                    is_add: event.notice_type === "reaction_added",
                },
            };
        case "interaction":
            if (event.sub_type !== "poke" || !operatorId || !userId) return null;
            return groupId
                ? {
                      ...base,
                      event_type: "group_nudge",
                      data: {
                          group_id: groupId,
                          sender_id: operatorId,
                          receiver_id: userId,
                          display_action: stringField(event, "action"),
                          display_suffix: stringField(event, "suffix"),
                          display_action_img_url: "",
                      },
                  }
                : {
                      ...base,
                      event_type: "friend_nudge",
                      data: {
                          user_id: operatorId === event.bot_id.number ? userId : operatorId,
                          is_self_send: operatorId === event.bot_id.number,
                          is_self_receive: userId === event.bot_id.number,
                          display_action: stringField(event, "action"),
                          display_suffix: stringField(event, "suffix"),
                          display_action_img_url: "",
                      },
                  };
        case "friend_add":
            return userId
                ? { ...base, event_type: "friend_increase", data: { user_id: userId } }
                : null;
        default:
            return null;
    }
}

function isGroupDisband(event: CommonEvent.Notice): boolean {
    const icqq = event.extensions?.icqq;
    return Boolean(icqq && typeof icqq === "object" && "is_dismiss" in icqq && icqq.is_dismiss);
}

function duration(event: CommonEvent.Notice): number {
    return typeof event.duration === "number" && Number.isSafeInteger(event.duration)
        ? event.duration
        : 0;
}

function stringField(event: CommonEvent.Notice, key: string): string {
    return typeof event[key] === "string" ? event[key] : "";
}
