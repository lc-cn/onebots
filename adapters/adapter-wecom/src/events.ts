import { coerceUnixToEventMs, type CommonEvent, type CommonTypes } from "onebots";
import type { WeComEvent } from "./types.js";

export interface WeComProjectionContext {
    botId: string;
    createId(value: string | number): CommonTypes.Id;
}

/** 将企业微信原生回调无副作用地投影成 CommonEvent。 */
export function projectWeComEvent(
    event: WeComEvent,
    context: WeComProjectionContext,
): CommonEvent.Event<WeComEvent> {
    const eventType = event.Event;
    const timestamp = coerceUnixToEventMs(event.CreateTime);
    const eventId =
        event.MsgId ??
        `${event.FromUserName ?? "unknown"}:${eventType ?? event.MsgType ?? "event"}:${timestamp}`;
    const base = {
        id: context.createId(eventId),
        timestamp,
        platform: "wecom",
        bot_id: context.createId(event.AgentID ?? context.botId),
        raw_event: event,
    };

    if (event.MsgType && event.MsgType !== "event") {
        return {
            ...base,
            type: "message",
            message_type: "private",
            sender: {
                id: context.createId(event.FromUserName ?? ""),
                name: event.FromUserName,
            },
            message_id: context.createId(eventId),
            raw_message: event.Content ?? event.Label ?? event.Title ?? "",
            message: projectWeComSegments(event),
        };
    }

    if (eventType === "change_contact") {
        const noticeType = contactNoticeTypes[event.ChangeType ?? ""];
        return {
            ...base,
            type: "notice",
            notice_type: noticeType ?? "custom",
            user: event.UserID ? { id: context.createId(event.UserID) } : undefined,
            extensions: noticeType
                ? undefined
                : { wecom: { event_type: eventType, change_type: event.ChangeType } },
        };
    }

    if (eventType === "change_external_contact") {
        const noticeType = externalContactNoticeTypes[event.ChangeType ?? ""] ?? "custom";
        return {
            ...base,
            type: "notice",
            notice_type: noticeType,
            user: event.ExternalUserID ? { id: context.createId(event.ExternalUserID) } : undefined,
            operator: event.UserID ? { id: context.createId(event.UserID) } : undefined,
            extensions: {
                wecom: {
                    event_type: eventType,
                    change_type: event.ChangeType,
                    state: event.State,
                    welcome_code: event.WelcomeCode,
                    fail_reason: event.FailReason,
                },
            },
        };
    }

    if (eventType === "change_external_chat") {
        return {
            ...base,
            type: "notice",
            notice_type: "custom",
            group: event.ChatId ? { id: context.createId(event.ChatId) } : undefined,
            operator: event.UserID ? { id: context.createId(event.UserID) } : undefined,
            extensions: {
                wecom: {
                    event_type: eventType,
                    change_type: event.ChangeType,
                    update_detail: event.UpdateDetail,
                },
            },
        };
    }

    if (eventType && interactionEvents.has(eventType.toLowerCase())) {
        return {
            ...base,
            type: "notice",
            notice_type: "interaction",
            sub_type: eventType.toLowerCase(),
            user: event.FromUserName ? { id: context.createId(event.FromUserName) } : undefined,
            extensions: {
                wecom: {
                    event_type: eventType,
                    event_key: event.EventKey,
                    task_id: event.TaskId,
                    response_code: event.ResponseCode,
                },
            },
        };
    }

    return {
        ...base,
        type: "notice",
        notice_type: "custom",
        user: event.FromUserName ? { id: context.createId(event.FromUserName) } : undefined,
        extensions: {
            wecom: {
                event_type: eventType,
                change_type: event.ChangeType,
            },
        },
    };
}

export function projectWeComSegments(event: WeComEvent): CommonTypes.Segment[] {
    switch (event.MsgType) {
        case "text":
            return [{ type: "text", data: { text: event.Content ?? "" } }];
        case "image":
            return [{ type: "image", data: { file_id: event.MediaId, url: event.PicUrl } }];
        case "voice":
            return [
                {
                    type: "audio",
                    data: {
                        file_id: event.MediaId,
                        format: event.Format,
                        recognition: event.Recognition,
                    },
                },
            ];
        case "video":
        case "shortvideo":
            return [{ type: "video", data: { file_id: event.MediaId } }];
        case "file":
            return [{ type: "file", data: { file_id: event.MediaId } }];
        case "location":
            return [
                {
                    type: "location",
                    data: {
                        latitude: event.Location_X,
                        longitude: event.Location_Y,
                        scale: event.Scale,
                        label: event.Label,
                    },
                },
            ];
        case "link":
            return [
                {
                    type: "link",
                    data: {
                        title: event.Title,
                        description: event.Description,
                        url: event.Url,
                    },
                },
            ];
        default:
            return [{ type: "wecom_message", data: { event: structuredClone(event) } }];
    }
}

const contactNoticeTypes: Record<string, CommonEvent.NoticeType> = {
    create_user: "user_added",
    update_user: "user_updated",
    delete_user: "user_removed",
};

const externalContactNoticeTypes: Record<string, CommonEvent.NoticeType> = {
    add_external_contact: "friend_add",
    add_half_external_contact: "friend_add",
    edit_external_contact: "user_updated",
    del_external_contact: "friend_remove",
};

const interactionEvents = new Set([
    "enter_agent",
    "click",
    "view",
    "scancode_push",
    "scancode_waitmsg",
    "pic_sysphoto",
    "pic_photo_or_album",
    "pic_weixin",
    "location_select",
    "view_miniprogram",
    "template_card_event",
    "template_card_menu_event",
]);
